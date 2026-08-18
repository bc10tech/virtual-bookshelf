import { SPLASH } from '../config.js';
import { ensureFonts } from '../scene/cover.js';
import { reducedMotion } from '../scene/tween.js';
import { splashTitle } from './splashTitle.js';

/**
 * Splash de abertura em tres fases: a logo aparece no centro, o titulo emerge
 * de tras dela, e o conjunto inteiro sai pela esquerda revelando a estante.
 *
 * Como nao existe roteador, ela cobre o `boot()` inteiro — e por isso e tambem
 * a tela de CARREGAMENTO: so sai quando o titulo terminou *e* a estante ficou
 * pronta (ou o teto `MAX_WAIT_MS` estourou, e as capas terminam de chegar por
 * tras dela). Uso, no `main.js`:
 *
 *   const splash = createSplash(document.getElementById('splash'));
 *   splash.intro(me());          // nao se espera: corre junto com o boot
 *   ...                          // monta a cena numa promise que nunca rejeita
 *   await splash.leave(ready);   // sai e se remove do DOM
 *
 * O movimento e todo do CSS (classes + `@keyframes`); daqui saem so as classes,
 * as duracoes do `config.js` em `--splash-*-ms` e a largura medida do titulo.
 * Nada de `requestAnimationFrame` nem de `tween.js`: o loop do renderer e sob
 * demanda e uma animacao de DOM nao tem por que acorda-lo.
 *
 * @param {HTMLElement} root elemento `.splash` que ja veio no HTML
 */
export function createSplash(root) {
  const lockup = root.querySelector('.splash__lockup');
  const title = root.querySelector('.splash__title');

  // Sem movimento: as fases 1 e 2 acontecem no mesmo flush (o CSS ja zera as
  // duracoes) e a saida vira fade. O teto do PREP continua valendo — ele espera
  // DADO, nao animacao, e sem ele o titulo sairia generico para quem so pediu
  // menos movimento.
  const calm = reducedMotion();
  const pause = (ms) => wait(calm ? 0 : ms);

  let startedAt = 0;
  let titleDone = Promise.resolve();
  let leaving = null;

  function intro(userPromise) {
    startedAt = now();
    root.style.setProperty('--splash-logo-ms', `${SPLASH.LOGO_MS}ms`);
    root.style.setProperty('--splash-exit-ms', `${SPLASH.EXIT_MS}ms`);

    // Fase 1: tirar o `hidden` e o que dispara a animacao da logo.
    lockup.hidden = false;

    titleDone = phaseTitle(userPromise).catch((err) => console.error('[splash]', err));
    return titleDone;
  }

  /** Fases 1 e 2: espera o usuario e a fonte, escreve o titulo e o revela. */
  async function phaseTitle(userPromise) {
    const deadline = startedAt + SPLASH.PREP_MS;
    const user = await race(userPromise, deadline - now());

    const parts = splashTitle(user);
    // A Bitter precisa estar carregada ANTES da medida: medir na Georgia daria
    // uma largura errada, e o conjunto ficaria fora do centro.
    await race(ensureFonts(parts.map((p) => p.text).join('')), deadline - now());

    title.replaceChildren(
      ...parts.map((part) => {
        const span = document.createElement('span');
        if (part.accent) span.className = 'splash__accent';
        span.textContent = part.text;
        return span;
      }),
    );

    // Quebrado em duas linhas, a CAIXA do titulo fica na largura maxima, e nao
    // na da linha mais larga — o conjunto ficaria visivelmente fora do centro.
    // Medir a tinta com um Range e fixar essa largura resolve, e a quebra nao
    // muda: a linha mais larga continua cabendo. Esta leitura e tambem o flush
    // de layout que faz a fase 2 partir do estado certo: sem ela, o titulo
    // recem-escrito e a classe `is-titled` cairiam na mesma recalculada, a
    // transicao partiria do transform ANTIGO (calculado com o titulo ainda
    // vazio) e o texto comecaria visivel.
    const range = document.createRange();
    range.selectNodeContents(title);
    const width = Math.ceil(range.getBoundingClientRect().width);
    title.style.width = `${width}px`;
    root.style.setProperty('--splash-title-w', `${width}px`);

    // Segundo flush, e ele importa: e o que faz o salto do conjunto para a
    // posicao compensada acontecer AGORA, sem transicao. Escrever a duracao na
    // mesma recalculada faria esse salto virar um deslize de 500 ms para a
    // direita, que a fase 2 desfaria em seguida.
    void root.offsetWidth;

    // So agora: enquanto `--splash-title-ms` nao existe, a regra de
    // `transition` e invalida e nada do que veio acima anima.
    root.style.setProperty('--splash-title-ms', `${SPLASH.TITLE_MS}ms`);

    // O que sobrou da fase 1 — a logo tem seu tempo sozinha na tela.
    await pause(SPLASH.LOGO_MS - (now() - startedAt));

    root.classList.add('is-titled'); // fase 2
    await pause(SPLASH.TITLE_MS + SPLASH.HOLD_MS);
  }

  /**
   * Fase 3. Idempotente: a segunda chamada devolve a mesma promise. Nunca
   * rejeita — uma splash presa na tela seria pior que qualquer erro.
   *
   * @param {Promise<unknown>} readyPromise estante montada (nao pode rejeitar)
   */
  function leave(readyPromise) {
    leaving ??= exit(readyPromise);
    return leaving;
  }

  async function exit(readyPromise) {
    try {
      // O teto conta do inicio da splash, nao daqui: o titulo ja consumiu parte
      // dele, e o usuario nao deve esperar as duas coisas em fila.
      await Promise.all([
        titleDone,
        race(readyPromise, startedAt + SPLASH.MAX_WAIT_MS - now()),
      ]);
      // Com movimento reduzido a saida e um fade da MESMA duracao (regra propria
      // no bloco reduced-motion do CSS), entao a rede e a mesma nos dois casos.
      root.classList.add('is-leaving');
      await Promise.race([transitionEnd(root), wait(SPLASH.EXIT_MS + SAFETY_MS)]);
    } catch (err) {
      console.error('[splash]', err);
    } finally {
      root.remove();
    }
  }

  return { intro, leave };
}

/**
 * Margem sobre a duracao da saida. E rede, nao tempo de design: se o
 * `transitionend` nunca vier (aba em segundo plano, transicao interrompida), a
 * splash some assim mesmo. Por isso nao mora no `config.js`.
 */
const SAFETY_MS = 50;

const now = () => performance.now();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Corrida com teto que nunca rejeita: passou do tempo, segue com `undefined`. */
const race = (promise, ms) =>
  Promise.race([Promise.resolve(promise).catch(() => null), wait(ms)]);

const transitionEnd = (el) =>
  new Promise((resolve) => {
    el.addEventListener('transitionend', function done(e) {
      if (e.target !== el) return; // transicoes de filhos borbulham ate aqui
      el.removeEventListener('transitionend', done);
      resolve();
    });
  });
