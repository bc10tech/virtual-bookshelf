import './styles.css';

import { hasWebGL, initRenderer, resizeRenderer, setSceneBackground } from './scene/renderer.js';
import { initControls } from './scene/camera.js';
import { ensureFonts, warmCover } from './scene/cover.js';
import {
  initStage,
  addRecord,
  updateRecord,
  removeRecord,
  setActiveCase,
  setSort,
  currentSort,
  setOnSelect,
  setOnCasesChanged,
  bindPicking,
  deselect,
} from './scene/stage.js';
import { createPanel } from './ui/panel.js';
import { createPager } from './ui/pager.js';
import { createDetails } from './ui/details.js';
import { createSortMenu } from './ui/sortMenu.js';
import { createTheme } from './ui/theme.js';
import { createSplash } from './ui/splash.js';
import { createGate, authFlagFromSearch } from './ui/gate.js';
import { createAccountMenu } from './ui/account.js';
import { createInvitesDialog } from './ui/invites.js';
import * as api from './data/api.js';
import * as invitesApi from './data/invites.js';
import { me, logout } from './data/user.js';

const $ = (id) => document.getElementById(id);
const live = $('live');

/** Anuncio para leitor de tela; tambem serve de log discreto de estado. */
const announce = (text) => {
  live.textContent = text;
};

function toast(message, kind = 'error') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 7000);
}

function noWebGL() {
  const p = document.createElement('p');
  p.className = 'fallback';
  p.textContent =
    'Seu navegador não conseguiu iniciar o WebGL, então a estante 3D não pode ser desenhada.';
  document.querySelector('.stage').replaceChildren(p);
}

const SERVER_DOWN = 'Não consegui falar com o servidor. Confira se o Docker e o `npm run dev` estão de pé.';

async function boot() {
  const canvas = $('scene');

  // Primeira coisa do boot: a splash ja esta na tela desde o HTML, e daqui em
  // diante ela e a tela de carregamento. `me()` e chamado UMA vez e a promise e
  // compartilhada: a splash espera por ela so ate o teto do config (para o
  // titulo), e o boot espera por ela de verdade (para saber se ha alguem).
  const splash = createSplash($('splash'));
  const session = me();
  splash.intro(session);

  // O servidor volta do login com `?auth=...` quando algo nao deu certo. Le e
  // limpa da URL antes de qualquer coisa: um F5 nao deve repetir o aviso.
  const flag = authFlagFromSearch(location.search);
  if (flag) history.replaceState(null, '', location.pathname);

  if (!hasWebGL()) {
    noWebGL();
    await splash.leave(Promise.resolve());
    return;
  }

  // O tema vem ANTES do renderer, porque a tela de entrada tambem precisa dele.
  // O callback so toca a cena depois que ela existe.
  let sceneUp = false;
  const theme = createTheme($('theme'), (t) => sceneUp && setSceneBackground(t));

  let user = null;
  try {
    user = await session;
  } catch (err) {
    toast(SERVER_DOWN);
    console.error('[app]', err);
  }

  // Visitante (401) ou servidor fora: a cena 3D nem e inicializada — nao ha o
  // que desenhar, e a GPU fica quieta. A splash sai revelando a tela de
  // entrada. Login e logout sao navegacoes completas, entao este estado e
  // terminal na vida da pagina.
  if (!user) {
    // `hidden`, nao so cobertos: senao continuariam focaveis por Tab. So o
    // botao de tema fica — a tela de entrada tambem tem claro e escuro.
    $('fab').hidden = true;
    $('corner-left').parentElement.hidden = true;
    $('account').parentElement.hidden = true;
    createGate($('gate')).show(flag);
    await splash.leave(Promise.resolve());
    return;
  }

  initRenderer(canvas);
  sceneUp = true;
  setSceneBackground(theme.theme);
  const stage = canvas.parentElement;
  resizeRenderer(stage.clientWidth || 1, stage.clientHeight || 1);
  initControls(canvas);
  bindPicking(canvas);

  // Carregado antes de qualquer atlas: texto desenhado em canvas com a fonte
  // ainda nao carregada ficaria com o fallback assado na textura para sempre.
  ensureFonts();

  const details = createDetails($('details'));
  details.onClose = () => deselect();

  // A ancora e o ponto da tela onde o usuario clicou: o cartao nasce junto do
  // livro, e se grampeia sozinho para nunca ficar cortado.
  setOnSelect((rec, anchor) => (rec ? details.show(rec, anchor) : details.hide()));

  const pager = createPager($('pager'), (i) => {
    details.hide();
    setActiveCase(i).catch((err) => console.error('[app]', err));
  });
  setOnCasesChanged((count, active) => pager.update(count, active));

  const sortMenu = createSortMenu({
    toggle: $('corner-left'),
    pill: $('sort-by'),
    menu: $('sort-menu'),
    getSort: currentSort,
    onSelect: (next) => {
      details.hide();
      setSort(next).catch((err) => console.error('[app]', err));
    },
  });

  // Convites: so o admin tem o dialogo (e o item no menu). Para os outros o
  // objeto nem existe, e o servidor responde 403 de todo jeito.
  const invites =
    user.role === 'admin'
      ? createInvitesDialog($('invites'), {
          ...invitesApi,
          onOpen() {
            deselect();
            sortMenu.close();
            panel?.close({ returnFocus: false });
          },
        })
      : null;

  const account = createAccountMenu({
    toggle: $('account'),
    menu: $('account-menu'),
    user,
    onInvite: () => invites?.open(),
    async onLogout() {
      try {
        await logout();
      } catch (err) {
        console.error('[app]', err);
      }
      // Recarrega mesmo se o POST falhou: o cookie pode ja ter morrido do lado
      // de la, e a pagina limpa e o unico estado seguro depois de "Sair".
      location.replace('/');
    },
  });

  // O retorno do painel e guardado: e por ele que o botao "Editar" do cartao
  // reabre o formulario num registro que ja existe.
  const panel = createPanel({
    // Abrir o formulario limpa a selecao: o cartao de detalhes some junto com o
    // livro levantado, e os outros popovers se recolhem.
    onOpen() {
      deselect();
      sortMenu.close();
      account.close();
      invites?.close({ returnFocus: false });
    },

    // Escolheu um resultado: as capas (-M da estante, -L da apresentacao)
    // comecam a baixar ja, enquanto o resto do formulario e preenchido.
    onChoose(selection) {
      if (selection.coverUrl) warmCover(selection.coverUrl);
    },

    async onSubmit(record) {
      // Persiste antes de animar: se o servidor recusar, nada aparece na
      // estante e a mensagem de erro fica no proprio formulario.
      const saved = await api.add(record);
      details.hide();

      // A animacao NAO e esperada de proposito: assim ela roda ao mesmo tempo
      // em que o painel se esvazia e colapsa, que e o efeito pedido. Esperar
      // aqui deixaria o formulario preenchido e aberto por 1,6 s.
      addRecord(saved)
        .then((placement) =>
          announce(
            `${saved.title} adicionado à estante ${placement.caseIndex + 1}, ` +
              `prateleira ${placement.shelfIndex + 1}.`,
          ),
        )
        .catch((err) => {
          console.error('[app]', err);
          toast('O livro foi salvo, mas não consegui desenhá-lo na estante.');
        });
    },

    async onUpdate(id, patch) {
      const saved = await api.update(id, patch);
      details.hide();
      await updateRecord(saved);
      announce(`${saved.title} atualizado.`);
    },

    async onDelete(id) {
      await api.remove(id);
      details.hide();
      await removeRecord(id);
      announce('Livro removido da estante.');
    },
  });

  details.onEdit = (rec) => {
    details.hide();
    sortMenu.close();
    panel.openForEdit(rec);
  };

  // A splash espera por esta promise, entao ela NAO pode rejeitar: um erro aqui
  // vira toast (que aparece por cima da splash, z-index 60 contra 50) e a
  // abertura segue seu curso ate o fim.
  const ready = (async () => {
    let records = [];
    try {
      records = await api.list();
    } catch (err) {
      // Sessao morreu entre o `me()` e o `list()` (raro; ex.: "Sair" noutra
      // aba): recomecar do zero cai na tela de entrada.
      if (err instanceof api.ApiError && err.status === 401) {
        location.replace('/');
        return [];
      }
      toast(SERVER_DOWN);
      console.error('[app]', err);
    }

    try {
      await initStage(records);
    } catch (err) {
      toast('Algo quebrou ao desenhar a estante. Veja o console para o detalhe.');
      console.error('[app]', err);
    }
    return records;
  })();

  await splash.leave(ready);

  const initial = await ready;
  if (initial.length) {
    announce(`${initial.length} ${initial.length === 1 ? 'livro' : 'livros'} na estante.`);
  }

  if (import.meta.env.DEV) installDebugHooks({ details, panel, invites });
}

/**
 * So no servidor de desenvolvimento (o `if` some do bundle de producao).
 * Existe para conferir pelo console as coisas que nao da para ver de fora:
 * a contagem de draw calls, a memoria de textura e o empacotamento por largura.
 *
 *   __shelf.seed(12, 600)   -> 12 livros de 600 paginas
 *   __shelf.stats()         -> draw calls, texturas, estantes
 *   __shelf.wipe()          -> limpa a MINHA estante
 *   __shelf.splash({ nickname: 'Bruno', gender: 'm' })  -> reprisa a abertura
 *   __shelf.me()            -> o usuario logado, como o servidor o ve
 *   __shelf.invites() / .invite(email) / .revoke(email)  -> a allowlist (admin)
 *   __shelf.logout()
 */
async function installDebugHooks({ details, panel, invites }) {
  const { renderer, booksGroup, camera, scene: sceneRef } = await import(
    './scene/renderer.js'
  );
  const { controls } = await import('./scene/camera.js');
  const { allRecords, caseCount } = await import('./scene/stage.js');

  const r3 = (v) => +v.toFixed(3);

  window.__shelf = {
    camera: () => ({
      posicao: camera.position.toArray().map(r3),
      alvo: controls.target.toArray().map(r3),
      distancia: r3(camera.position.distanceTo(controls.target)),
      aspect: r3(camera.aspect),
      limites: [r3(controls.minDistance), r3(controls.maxDistance)],
      canvas: [renderer.domElement.width, renderer.domElement.height],
      dpr: renderer.getPixelRatio(),
    }),
    /**
     * Renderiza e devolve a cena como data URL. O render tem de acontecer na
     * MESMA tarefa da leitura: com `preserveDrawingBuffer: false` (que e o que
     * queremos em producao) o buffer e descartado no fim do frame.
     */
    snapshot(width = 420, quality = 0.6) {
      renderer.render(sceneRef, camera);
      const src = renderer.domElement;
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.round((width * src.height) / src.width);
      out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', quality);
    },
    /** Posicao de um livro em coordenadas de tela, para simular cliques reais. */
    screenOf(title) {
      const m = booksGroup.children.find((c) => c.userData.record?.title === title);
      if (!m) return null;
      const v = m.position.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return {
        x: r.left + ((v.x + 1) / 2) * r.width,
        y: r.top + ((1 - v.y) / 2) * r.height,
      };
    },
    /** Colocacao calculada de cada livro — valida o empacotamento por largura. */
    layout: () =>
      allRecords().map((r) => {
        const m = booksGroup.children.find((c) => c.userData.record?._id === r._id);
        return {
          id: r._id,
          titulo: r.title,
          paginas: r.pages,
          nota: r.rating,
          espessura: m ? r3(m.scale.x) : null,
          prateleira: m ? m.userData.placement.shelfIndex : null,
          estante: m ? m.userData.placement.caseIndex : null,
          x: m ? r3(m.position.x) : null,
          y: m ? r3(m.position.y) : null,
        };
      }),
    stats: () => ({
      drawCalls: renderer.info.render.calls,
      texturas: renderer.info.memory.textures,
      geometrias: renderer.info.memory.geometries,
      livrosNaCena: booksGroup.children.length,
      livrosNoTotal: allRecords().length,
      estantes: caseCount(),
      ordem: currentSort(),
      tema: document.documentElement.dataset.theme,
    }),
    sort: (by, dir = 'asc') => setSort({ by, dir }),
    /**
     * Reprisa a abertura. Sem argumento usa o usuario logado de verdade; com
     * `{ nickname, gender }` simula outro (o apelido so existe no perfil, item
     * 4, entao e assim que se ve a personalizacao hoje). O markup original ja
     * foi removido do DOM na saida, entao aqui ele e remontado igual.
     */
    async splash(user) {
      document.getElementById('splash')?.remove();

      const el = document.createElement('div');
      el.id = 'splash';
      el.className = 'splash';
      const lockup = document.createElement('div');
      lockup.className = 'splash__lockup';
      lockup.hidden = true;
      const logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      logo.setAttribute('class', 'splash__logo');
      logo.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-logo');
      logo.append(use);
      const reveal = document.createElement('div');
      reveal.className = 'splash__reveal';
      const h1 = document.createElement('h1');
      h1.className = 'splash__title';
      reveal.append(h1);
      lockup.append(logo, reveal);
      el.append(lockup);
      document.body.append(el);

      const preview = createSplash(el);
      preview.intro(user === undefined ? me() : Promise.resolve(user));
      await preview.leave(Promise.resolve());
    },
    me,
    invites: invitesApi.list,
    invite: invitesApi.invite,
    revoke: invitesApi.revoke,
    invitesDialog: invites,
    async logout() {
      await logout();
      location.replace('/');
    },
    /** Abre o cartao numa ancora arbitraria — testa o grampo contra a viewport. */
    card: (index, x, y) => details.show(allRecords()[index], { x, y }),
    edit: (index) => panel.openForEdit(allRecords()[index]),
    async seed(n = 5, pages = 300) {
      for (let i = 0; i < n; i++) {
        const saved = await api.add({
          title: `Livro de teste ${allRecords().length + 1}`,
          author: 'Autor de Teste',
          pages,
          startDate: '2026-01-01',
          rating: (i % 5) + 1,
          review: 'Semeado pelo console.',
        });
        await addRecord(saved);
      }
      return this.stats();
    },
    async wipe() {
      for (const r of [...allRecords()]) await api.remove(r._id);
      location.reload();
    },
    records: allRecords,
  };
}

boot().catch((err) => {
  console.error('[app] falha no boot', err);
  // Ultimo recurso: se o boot morreu antes do `splash.leave`, o overlay ficaria
  // na frente do erro para sempre. O gate idem.
  document.getElementById('splash')?.remove();
  document.getElementById('gate')?.remove();
  toast('Algo quebrou ao iniciar a estante. Veja o console para o detalhe.');
});
