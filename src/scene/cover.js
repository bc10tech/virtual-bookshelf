import { CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';
import { COVER, KD, kdToCss } from '../config.js';
import { editionKey } from './layout.js';

/**
 * Uma capa vira um atlas 256x256 desenhado em canvas: capa, lombada,
 * contracapa e miolo na mesma textura. Um livro = 1 textura = 1 material =
 * 1 draw call.
 */

// Neuton nao tem peso 600 — o titulo/lombada usam 700.
const FONT = 'Neuton';
const W_BOLD = 700;
const W_REG = 400;
const PAGES_CSS = kdToCss(KD.bookPages);
const FOIL_CSS = kdToCss(KD.bookFoil);

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
 * `crossOrigin = 'anonymous'` e obrigatorio: a Open Library manda
 * `Access-Control-Allow-Origin: *`, mas sem o atributo o browser ainda assim
 * contamina o canvas, e tanto getImageData quanto o upload para o WebGL passam
 * a lancar SecurityError — apagando todas as capas silenciosamente.
 */
function loadImage(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    const timer = setTimeout(() => {
      img.src = '';
      resolve(null);
    }, timeoutMs);
    const done = (v) => {
      clearTimeout(timer);
      resolve(v);
    };

    img.onload = () => done(img.naturalWidth > 1 ? img : null);
    img.onerror = () => done(null);
    img.src = url;
  });
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

// ---------------------------------------------------------------- desenho ---

/** Corta a imagem no centro para preencher a celula sem distorcer (object-fit: cover). */
function drawCovering(ctx, img, cell) {
  const scale = Math.max(cell.w / img.naturalWidth, cell.h / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
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
 * Monta o atlas de um livro.
 * @param {object} rec documento do livro
 * @returns {Promise<CanvasTexture>}
 */
export async function buildCoverTexture(rec) {
  await ensureFonts(`${rec.title}${rec.author ?? ''}`);

  const size = COVER.SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base creme: qualquer area do atlas que sobre ja fica com a cor do miolo,
  // em vez de transparente (que suja os niveis de mipmap).
  ctx.fillStyle = PAGES_CSS;
  ctx.fillRect(0, 0, size, size);

  const img = rec.coverUrl ? await loadImage(rec.coverUrl) : null;
  const sampled = img ? dominantColor(img) : null;

  // Sem capa: escolhe uma das 4 cores de capa do .mtl original pela EDICAO (nao
  // pelo id do registro), para que a estante fique variada mas dois exemplares
  // do mesmo livro tenham a mesma cor — o mesmo motivo da altura.
  const palette =
    KD.bookCovers[Math.abs(hashCode(editionKey(rec))) % KD.bookCovers.length];
  const accent = sampled ?? {
    r: palette[0] * 255,
    g: palette[1] * 255,
    b: palette[2] * 255,
  };

  if (img) {
    try {
      drawCovering(ctx, img, COVER.CELL_FRONT);
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

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // Os livros aparecem com ~30 px de largura na tela: sem mipmap as capas
  // cintilam violentamente a cada movimento de camera.
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = COVER.MAX_ANISOTROPY;
  return tex;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
