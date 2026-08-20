import {
  CanvasTexture,
  SRGBColorSpace,
  LinearMipmapLinearFilter,
  LinearFilter,
} from 'three';
import { ANIM, COVER, KD, OL, kdToCss } from '../config.js';
import { editionKey, bookDimensions, rememberCoverAspect } from './layout.js';

/**
 * Uma capa vira um atlas desenhado em canvas: capa, lombada, contracapa e
 * miolo na mesma textura. Um livro = 1 textura = 1 material = 1 draw call.
 *
 * O desenho acontece numa grade de COVER.UNITS (256) e o canvas real e maior
 * ou igual: `ctx.scale` faz o resto, e o texto — vetorial — sai rasterizado na
 * resolucao real. Por isso as mesmas funcoes desenham o atlas da estante (512
 * px no desktop, 256 no celular) e o atlas temporario da apresentacao (1024).
 */

/**
 * A lombada e a capa sao o LIVRO, entao usam a serifada — titulo em 700, autor
 * em 400. Manter o autor tambem em Bitter (e nao na sans da interface) e o que
 * deixa este arquivo com uma unica constante de familia: os 5 pontos que montam
 * `ctx.font` e os 2 descritores de `ensureFonts` seguem todos iguais.
 */
const FONT = 'Bitter';
const W_BOLD = 700;
const W_REG = 400;
const PAGES_CSS = kdToCss(KD.bookPages);
const FOIL_CSS = kdToCss(KD.bookFoil);

const UNITS = COVER.UNITS;

/**
 * Mesmo criterio do `setPixelRatioCap` (renderer.js): ponteiro grosso e
 * celular, onde a lombada tem ~190 px de tela e o atlas de 256 basta. E num
 * monitor de DPR 1 a lombada tem ~165 css px < 256 texels — 512 nao ganharia
 * nada e custaria 4x de memoria.
 */
const coarse =
  window.matchMedia('(pointer: coarse)').matches || (window.devicePixelRatio || 1) <= 1;
const ATLAS_PX = coarse ? COVER.ATLAS_PX_COARSE : COVER.ATLAS_PX_FINE;
const PRESENT_PX = coarse ? COVER.PRESENT_PX_COARSE : COVER.PRESENT_PX_FINE;

// --------------------------------------------------------------- fontes ---

let fontsReady;

/**
 * Texto em canvas usa a fonte de fallback se a webfont ainda nao carregou — e
 * isso fica assado na textura para sempre. Por isso todo desenho espera aqui.
 *
 * O `text` importa: a fonte esta dividida em subsets `latin` e `latin-ext` por
 * `unicode-range`, e o browser so baixa o subset que os caracteres pedidos
 * exigem. Passando o titulo real, um autor tcheco ou turco puxa o latin-ext
 * sozinho, e quem so le em portugues nunca paga por ele.
 */
export function ensureFonts(text = '') {
  fontsReady ??= Promise.all([
    document.fonts.load(`${W_BOLD} ${COVER.FRONT_TITLE_PX}px "${FONT}"`),
    document.fonts.load(`${W_REG} ${COVER.SPINE_AUTHOR_PX}px "${FONT}"`),
  ]).catch(() => {}); // sem a fonte o desenho continua, so menos bonito

  if (!text) return fontsReady;
  return fontsReady.then(() =>
    Promise.all([
      document.fonts.load(`${W_BOLD} ${COVER.FRONT_TITLE_PX}px "${FONT}"`, text),
      document.fonts.load(`${W_REG} ${COVER.SPINE_AUTHOR_PX}px "${FONT}"`, text),
    ]).catch(() => {}),
  );
}

// ---------------------------------------------------------------- imagem ---

/**
 * Disjuntor do host de capas — tres estados, sem nenhum timer.
 *
 *   FECHADO    tudo passa.
 *   ABERTO     nada passa; cada capa desiste na hora e cai na procedural.
 *   MEIO-ABERTO  passada a espera, UMA capa vira sonda. Se ela vier, o
 *                disjuntor fecha e a vida volta ao normal; se estourar, abre
 *                de novo e o relogio recomeca.
 *
 * O relogio e o proprio pedido de capa: nao ha `setInterval` sondando o host em
 * segundo plano. Isso e deliberado — a pagina parada nao faz nem um frame nem
 * uma requisicao, e um disjuntor que fica cutucando a rede sozinho contradiria
 * isso. O preco esta comentado no `coversRecovered`.
 *
 * As duas regras, e as duas custaram um teste para chegar nesta forma:
 *
 *   SO TIMEOUT ABRE. `onerror` nao abre porque, com `?default=false`, obra sem
 *   capa devolve 404 — e num acervo de livros obscuros isso e o caso NORMAL.
 *   Conta-lo abriria o disjuntor numa estante saudavel e apagaria as capas que
 *   existem. O disjuntor defende contra ESPERA, entao so espera o abre.
 *
 *   SO IMAGEM FECHA. `onerror` tambem nao fecha, e este e o lado que eu errei
 *   primeiro: e tentador tratar erro rapido como "o host respondeu, logo esta
 *   de pe", mas num host inalcancavel o browser desiste de esperar e passa a
 *   errar rapido justamente por estar fora. Fechando ali, cada erro reabria a
 *   porta e o livro seguinte pagava outro timeout — 11 capas custavam 13 s em
 *   vez dos 8 s de uma unica rodada. `onerror` e inconclusivo e nao mexe em
 *   nada; so uma imagem de verdade prova que o host serve.
 */
const breaker = { failures: 0, openedAt: 0, probing: false };

/**
 * Sentinela para "nao obtive resposta" — recusa do disjuntor OU espera
 * estourada. Os dois casos sao a mesma coisa para quem le: a capa procedural e
 * PROVISORIA, e o livro deve ser redesenhado quando o host voltar.
 *
 * O que ela distingue e o desfecho DEFINITIVO, que devolve `null`: `onerror`
 * com `?default=false` quer dizer que a obra nao tem capa mesmo, e ai a
 * procedural e a resposta final — redesenhar seria trabalho a toa para sempre.
 */
const SEM_RESPOSTA = Symbol('sem resposta do host');

const breakerIsOpen = () => breaker.failures >= COVER.BREAKER_FAILURES;

/** `false` = barrado. Senao devolve por onde passou, que muda o que um timeout significa. */
function breakerAllows() {
  if (!breakerIsOpen()) return 'normal';
  if (performance.now() - breaker.openedAt < COVER.BREAKER_COOLDOWN_MS) return false;
  if (breaker.probing) return false; // meio-aberto: uma sonda por vez, nao seis
  breaker.probing = true;
  return 'sonda';
}

function breakerRecordTimeout(foiSonda) {
  const eraAberto = breakerIsOpen();
  breaker.probing = false;
  breaker.failures++;

  // A hora e carimbada na TRANSICAO (fechado -> aberto) e quando uma SONDA
  // estoura (ai a espera tem mesmo que recomecar). Nunca a cada timeout: as
  // chamadas que ja estavam em voo quando ele abriu — sao seis workers —
  // empurrariam a espera para frente de graca, e a primeira sonda demoraria
  // um multiplo do que esta escrito no config.
  if (!eraAberto || foiSonda) breaker.openedAt = performance.now();
}

/**
 * Uma imagem de verdade chegou: o host serve. E a UNICA prova que fecha o
 * disjuntor. Zera sempre, nao so quando estava aberto — falhas isoladas ao
 * longo de uma sessao longa nao devem se somar ate abrir sozinhas.
 */
function breakerRecordSuccess() {
  const eraAberto = breakerIsOpen();
  breaker.probing = false;
  breaker.failures = 0;
  if (eraAberto) flushRecovered();
}

/**
 * `onerror` — que e tudo o que a Image API conta. Pode ser o 404 de uma obra
 * sem capa (caso normal, host de pe) ou uma conexao que morreu (host fora). Nao
 * da para distinguir os dois, entao nao conta para nenhum lado: nao abre o
 * disjuntor e, principalmente, NAO O FECHA.
 *
 * Fechar aqui foi a primeira versao e estava errado. Num host inalcancavel o
 * browser para de esperar e passa a errar rapido, entao cada erro reabria a
 * porta e o livro seguinte pagava mais um timeout inteiro: 11 capas viravam 13
 * s em vez dos 8 s de uma unica rodada.
 */
function breakerRecordInconclusive(foiSonda) {
  breaker.probing = false;
  // Sonda inconclusiva gasta a vez e reinicia a espera. Sem isto, um acervo
  // cheio de obras sem capa viraria uma enxurrada de sondas.
  if (foiSonda) breaker.openedAt = performance.now();
}

/**
 * `crossOrigin = 'anonymous'` e obrigatorio: a Open Library manda
 * `Access-Control-Allow-Origin: *`, mas sem o atributo o browser ainda assim
 * contamina o canvas, e tanto getImageData quanto o upload para o WebGL passam
 * a lancar SecurityError — apagando todas as capas silenciosamente.
 */
function loadImage(url, timeoutMs = COVER.LOAD_TIMEOUT_MS) {
  const via = breakerAllows();
  if (!via) return Promise.resolve(SEM_RESPOSTA);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    // A promessa so resolve uma vez, mas os EFEITOS COLATERAIS aqui nao sao
    // idempotentes — e foi por isso que a primeira versao deste disjuntor nunca
    // conseguia ficar aberto. Duas coisas disparam `onerror` DEPOIS do timeout:
    // o `img.src = ''` que aborta o download, e o proprio erro de rede do
    // browser, que num host inalcancavel chega la pelos 21 s. Qualquer uma das
    // duas chamava `breakerRecordResponse()` e zerava a falha recem-anotada.
    let resolvido = false;

    const timer = setTimeout(() => {
      if (resolvido) return;
      resolvido = true;
      img.onload = img.onerror = null; // antes do src, senao o abort volta aqui
      img.src = '';
      breakerRecordTimeout(via === 'sonda');
      resolve(SEM_RESPOSTA); // provisorio, igual a recusa: nao sabemos se ha capa
    }, timeoutMs);

    const done = (v) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      if (v) breakerRecordSuccess();
      else breakerRecordInconclusive(via === 'sonda');
      resolve(v);
    };

    img.onload = () => done(img.naturalWidth > 1 ? img : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * Download que NAO e o atlas da estante: pre-aquecimento ao escolher um
 * resultado e a capa `-L` da apresentacao. Nao toca no disjuntor em nenhuma
 * direcao — nao abre, nao fecha, nao vira sonda — e por isso nao entra em
 * `refusedIds`. Com BREAKER_FAILURES = 1, uma `-L` (50-150 KB contra 14 KB da
 * `-M`) que estourasse o timeout pelo `loadImage` normal abriria a porta e
 * apagaria as capas de uma estante saudavel por 30 s; e no estado meio-aberto
 * ela roubaria a unica sonda. Respeita a porta ABERTA (devolve null na hora,
 * para nao gastar banda num host fora), mas nao opina sobre ela.
 */
function loadImageQuiet(url, timeoutMs) {
  if (!url || breakerIsOpen()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    let resolvido = false;
    const timer = setTimeout(() => {
      if (resolvido) return;
      resolvido = true;
      img.onload = img.onerror = null;
      img.src = '';
      resolve(null);
    }, timeoutMs);
    const done = (v) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      resolve(v);
    };
    img.onload = () => done(img.naturalWidth > 1 ? img : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** `-M.jpg` -> `-L.jpg` preservando o `?default=false`; null se a URL nao e da Open Library. */
const SHELF_SIZE_RE = new RegExp(`-${OL.COVER_SIZE_SHELF}\\.jpg(\\?|$)`);
export function hiResUrl(url) {
  if (!url) return null;
  const hi = url.replace(SHELF_SIZE_RE, `-${OL.COVER_SIZE_PRESENT}.jpg$1`);
  return hi === url ? null : hi;
}

// ---------------------------------------------------------- pre-aquecimento ---

/**
 * Ao escolher um resultado no painel, as duas capas (`-M` da estante e `-L` da
 * apresentacao) comecam a baixar enquanto a pessoa preenche datas, nota e
 * review. No cadastro, o `buildPresentTexture` consome a promessa da `-L`
 * daqui em vez de esperar a rede: a troca para a capa nitida acontece no
 * primeiro frame da apresentacao, nao no meio dela.
 *
 * Uma entrada so, a ultima escolha vence — o formulario so cadastra um livro
 * por vez, e guardar mais seria segurar imagens que nunca serao usadas.
 */
const warm = new Map();

export function warmCover(url) {
  const hi = hiResUrl(url);
  if (!url || warm.has(url)) return;
  warm.clear();
  warm.set(url, {
    m: loadImageQuiet(url, COVER.LOAD_TIMEOUT_MS),
    l: hi ? loadImageQuiet(hi, COVER.LOAD_TIMEOUT_MS) : Promise.resolve(null),
  });
}

// --------------------------------------------------------------- recuperacao ---

/**
 * Livros cuja capa procedural e PROVISORIA: o host nao respondeu, por recusa do
 * disjuntor ou por espera estourada. So esses precisam ser redesenhados quando
 * ele voltar — quem simplesmente nao tem capa nunca entra aqui, e e essa
 * distincao que impede a volta de reprocessar a estante inteira.
 */
const refusedIds = new Set();
let onRecoveredCb = null;

/**
 * Avisado quando o disjuntor fecha, com os ids que perderam a capa enquanto ele
 * esteve aberto. O `stage.js` usa isso para largar o atlas desses livros e
 * deixar o `syncScene` redesenha-los com a capa de verdade.
 *
 * O gatilho e o fechamento, que por sua vez depende de alguem PEDIR uma capa —
 * abrir o painel, trocar de estante, cadastrar um livro, recarregar. Uma aba
 * parada nao se cura sozinha, porque curar-se sozinha exigiria um poll de
 * fundo. Recarregar sempre resolve.
 */
export const setOnCoversRecovered = (cb) => {
  onRecoveredCb = cb;
};

function flushRecovered() {
  if (!refusedIds.size || !onRecoveredCb) return;
  const ids = [...refusedIds];
  refusedIds.clear();
  // Fora do turno atual de proposito: este ponto e alcancado de DENTRO de um
  // `createBooksBatched`, e avisar dali faria o ouvinte reentrar no `syncScene`
  // que ainda esta montando meshes.
  setTimeout(() => onRecoveredCb(ids), 0);
}

/** Cor media da capa: o proprio browser faz a reducao ao desenhar em 1x1. */
function dominantColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  } catch {
    return null; // canvas contaminado: cai no fallback
  }
}

const rgbCss = ({ r, g, b }, k = 1) =>
  `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

/** Luminancia relativa, para decidir entre texto claro e escuro. */
const isDark = ({ r, g, b }) => (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;

/**
 * Cor de destaque do livro: a media da capa quando ha imagem; sem capa, uma
 * das 4 cores de capa do .mtl original escolhida pela EDICAO (nao pelo id do
 * registro), para que a estante fique variada mas dois exemplares do mesmo
 * livro tenham a mesma cor — o mesmo motivo da altura.
 */
function accentFor(rec, img) {
  const sampled = img ? dominantColor(img) : null;
  if (sampled) return sampled;
  const palette =
    KD.bookCovers[Math.abs(hashCode(editionKey(rec))) % KD.bookCovers.length];
  return { r: palette[0] * 255, g: palette[1] * 255, b: palette[2] * 255 };
}

// ---------------------------------------------------------------- desenho ---

/**
 * Encaixa a imagem INTEIRA na celula, sem corte, ja compensando a diferenca
 * entre a proporcao da celula e a da face do livro onde ela vai ser mapeada:
 * a imagem e desenhada com proporcao `img x (celula / face)`, de modo que,
 * esticada para a face, saia exata. Quando a profundidade do livro seguiu a
 * propria capa (o caso normal), isso preenche a celula por completo; so quando
 * o clamp de profundidade morde sobra uma borda, na cor de destaque.
 */
function drawContained(ctx, img, cell, faceAspect, accent) {
  ctx.fillStyle = rgbCss(accent);
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h);

  const cellAspect = cell.w / cell.h;
  const r = (img.naturalWidth / img.naturalHeight) * (cellAspect / faceAspect);
  let w = cell.w;
  let h = w / r;
  if (h > cell.h) {
    h = cell.h;
    w = h * r;
  }
  ctx.drawImage(img, cell.x + (cell.w - w) / 2, cell.y + (cell.h - h) / 2, w, h);
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';

  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  if (lines.length === maxLines) {
    lines[maxLines - 1] = fitText(ctx, lines[maxLines - 1], maxWidth);
  }
  return lines;
}

/** Capa procedural: usada em entrada manual, 404 da Open Library ou falha de rede. */
function drawFallbackFront(ctx, rec, cell, accent) {
  ctx.fillStyle = rgbCss(accent);
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h);

  ctx.fillStyle = FOIL_CSS;
  ctx.fillRect(cell.x + 18, cell.y + 34, cell.w - 36, 2);
  ctx.fillRect(cell.x + 18, cell.y + cell.h - 46, cell.w - 36, 2);

  const light = isDark(accent);
  ctx.fillStyle = light ? '#F2EDE4' : '#1A1008';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.font = `${W_BOLD} ${COVER.FRONT_TITLE_PX}px "${FONT}", Georgia, serif`;
  const lines = wrapLines(ctx, rec.title, cell.w - 36, COVER.FRONT_TITLE_LINES);
  const lh = COVER.FRONT_TITLE_PX * 1.25;
  let y = cell.y + cell.h / 2 - (lines.length * lh) / 2 - 10;
  for (const l of lines) {
    ctx.fillText(l, cell.x + cell.w / 2, y);
    y += lh;
  }

  if (rec.author) {
    ctx.font = `${W_REG} ${COVER.FRONT_AUTHOR_PX}px "${FONT}", Georgia, serif`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(fitText(ctx, rec.author, cell.w - 36), cell.x + cell.w / 2, y + 10);
    ctx.globalAlpha = 1;
  }
}

/** Lombada: cor chapada e texto girado, lendo de cima para baixo. */
function drawSpine(ctx, rec, cell, accent) {
  ctx.fillStyle = rgbCss(accent);
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h);

  // Um fio de luz na borda frontal da lombada da volume sem custar geometria.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(cell.x, cell.y, 2, cell.h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(cell.x + cell.w - 2, cell.y, 2, cell.h);

  ctx.save();
  ctx.translate(cell.x + cell.w / 2, cell.y);
  ctx.rotate(Math.PI / 2); // o +x local passa a apontar para baixo da lombada
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = isDark(accent) ? '#F4EFE7' : '#1A1008';

  // O autor e medido ANTES de truncar o titulo: os dois compartilham o mesmo
  // eixo (o comprimento da lombada), e sem reservar o espaco dele um titulo
  // longo passa por cima do nome.
  const PAD = 14;
  const GAP = 10;
  let author = '';
  let authorW = 0;
  if (rec.author) {
    ctx.font = `${W_REG} ${COVER.SPINE_AUTHOR_PX}px "${FONT}", Georgia, serif`;
    author = fitText(ctx, rec.author, 96);
    authorW = ctx.measureText(author).width;
  }

  ctx.font = `${W_BOLD} ${COVER.SPINE_TITLE_PX}px "${FONT}", Georgia, serif`;
  const titleMax = cell.h - PAD * 2 - (authorW ? authorW + GAP : 0);
  ctx.fillText(fitText(ctx, rec.title, titleMax), PAD, 1);

  if (author) {
    ctx.font = `${W_REG} ${COVER.SPINE_AUTHOR_PX}px "${FONT}", Georgia, serif`;
    ctx.globalAlpha = 0.75;
    ctx.textAlign = 'right';
    ctx.fillText(author, cell.h - PAD, 1);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ----------------------------------------------------------------- atlas ---

/**
 * Desenha o atlas inteiro em UNIDADES num contexto ja escalado para a
 * resolucao real. `img` pode ser null (capa procedural).
 */
function drawAtlas(ctx, rec, img, accent) {
  // Base creme: qualquer area do atlas que sobre ja fica com a cor do miolo,
  // em vez de transparente (que suja os niveis de mipmap).
  ctx.fillStyle = PAGES_CSS;
  ctx.fillRect(0, 0, UNITS, UNITS);

  if (img) {
    // A face da capa tem a proporcao da PROFUNDIDADE do livro, que por sua vez
    // seguiu a imagem — a mesma conta que o layout faz, entao a imagem sai
    // exata na face.
    const { height, depth } = bookDimensions(rec);
    try {
      drawContained(ctx, img, COVER.CELL_FRONT, depth / height, accent);
    } catch {
      drawFallbackFront(ctx, rec, COVER.CELL_FRONT, accent);
    }
  } else {
    drawFallbackFront(ctx, rec, COVER.CELL_FRONT, accent);
  }

  drawSpine(ctx, rec, COVER.CELL_SPINE, accent);

  // Contracapa: a mesma cor um pouco mais escura.
  ctx.fillStyle = rgbCss(accent, 0.85);
  ctx.fillRect(COVER.CELL_BACK.x, COVER.CELL_BACK.y, COVER.CELL_BACK.w, COVER.CELL_BACK.h);

  ctx.fillStyle = PAGES_CSS;
  ctx.fillRect(COVER.CELL_PAGES.x, COVER.CELL_PAGES.y, COVER.CELL_PAGES.w, COVER.CELL_PAGES.h);
}

/** Canvas quadrado de `px` pixels reais, com o contexto ja em unidades. */
function atlasCanvas(px) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.scale(px / UNITS, px / UNITS);
  return { canvas, ctx };
}

function makeTexture(canvas) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // Os livros aparecem com ~30 px de largura na tela: sem mipmap as capas
  // cintilam violentamente a cada movimento de camera. (E o atlas da
  // apresentacao encolhe 10x durante o voo ate a prateleira.)
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = COVER.MAX_ANISOTROPY;
  return tex;
}

/**
 * Monta o atlas de um livro para a estante.
 * @param {object} rec documento do livro
 * @returns {Promise<CanvasTexture>}
 */
export async function buildCoverTexture(rec) {
  await ensureFonts(`${rec.title}${rec.author ?? ''}`);

  // Tres desfechos, e distingui-los e o que torna a volta barata: veio a capa;
  // a obra nao tem capa e a procedural e a resposta DEFINITIVA; ou o host nao
  // respondeu (recusa do disjuntor ou espera estourada) e a procedural e
  // PROVISORIA — este livro entra na lista de quem deve ser redesenhado quando
  // o host voltar.
  //
  // O pre-aquecimento (`warmCover`) e consultado primeiro: se a `-M` ja veio
  // por ele, nao ha rede nem disjuntor a consultar.
  let carregada = null;
  if (rec.coverUrl) {
    const quente = await (warm.get(rec.coverUrl)?.m ?? null);
    carregada = quente ?? (await loadImage(rec.coverUrl));
  }
  if (carregada === SEM_RESPOSTA) refusedIds.add(rec._id);
  else refusedIds.delete(rec._id);

  const img = carregada === SEM_RESPOSTA ? null : carregada;

  // A proporcao da capa decide a profundidade do livro (layout.js). SO a `-M`
  // anota: a `-L` da apresentacao difere dela por arredondamento, e 1 mm de
  // diferenca dispararia um reflow de nada no proximo syncScene.
  if (img) rememberCoverAspect(rec, img.naturalWidth / img.naturalHeight);

  const { canvas, ctx } = atlasCanvas(ATLAS_PX);
  drawAtlas(ctx, rec, img, accentFor(rec, img));
  return makeTexture(canvas);
}

/**
 * Atlas TEMPORARIO da apresentacao, com a capa `-L`. Vive so enquanto o livro
 * esta grande no centro da tela; quem chama descarta no pouso. Nunca rejeita e
 * nunca demora mais que a propria apresentacao — depois disso o resultado
 * seria jogado fora de qualquer jeito.
 * @returns {Promise<CanvasTexture|null>}
 */
export async function buildPresentTexture(rec) {
  try {
    const url = rec.coverUrl;
    if (!url) return null;
    const entry = warm.get(url);
    warm.delete(url);
    const img = await (entry?.l ?? loadImageQuiet(hiResUrl(url), ANIM.PRESENT_MS + ANIM.HOLD_MS));
    if (!img) return null;

    await ensureFonts(`${rec.title}${rec.author ?? ''}`);
    const { canvas, ctx } = atlasCanvas(PRESENT_PX);
    drawAtlas(ctx, rec, img, accentFor(rec, img));
    return makeTexture(canvas);
  } catch {
    return null;
  }
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
