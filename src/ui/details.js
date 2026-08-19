import { renderStars } from './stars.js';

/**
 * Cartao do livro clicado, ancorado ao ponto do clique.
 *
 * Toda string vinda do usuario ou da Open Library entra por `textContent`.
 * `innerHTML` e proibido neste codigo: a review e texto livre e volta do banco
 * intacta, entao esta e a unica barreira contra XSS — e ela precisa valer
 * tambem quando o login da fase 2 fizer uma estante ser vista por outra pessoa.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Folga minima entre o cartao e a borda da tela. */
const MARGIN = 12;
/** Deslocamento a partir do clique, para nao cobrir o proprio livro. */
const OFFSET = 14;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

function icon(symbolId, cls = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.append(use);
  return svg;
}

const fmtDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function periodText(rec) {
  const start = fmtDate(rec.startDate);
  const end = fmtDate(rec.endDate);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Desde ${start} · ainda lendo`;
  return 'Sem datas';
}

export function createDetails(root) {
  let onClose = () => {};
  let onEdit = () => {};
  let anchor = null;

  function hide() {
    root.hidden = true;
    root.replaceChildren();
    anchor = null;
  }

  /**
   * Posiciona o cartao junto da ancora. Tres passos, e o terceiro e o que
   * garante a promessa de nunca ficar cortado:
   *   1. posicao preferida, deslocada do clique;
   *   2. espelha para o outro lado se transbordar;
   *   3. grampeia contra a viewport (resolve o que o espelhamento nao resolveu,
   *      como um livro clicado no canto de uma janela baixa).
   */
  function place() {
    if (!anchor) return;

    const box = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.x + OFFSET;
    if (left + box.width > vw - MARGIN) left = anchor.x - OFFSET - box.width;

    let top = anchor.y + OFFSET;
    if (top + box.height > vh - MARGIN) top = anchor.y - OFFSET - box.height;

    left = clamp(left, MARGIN, vw - MARGIN - box.width);
    top = clamp(top, MARGIN, vh - MARGIN - box.height);

    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;

    // A animacao cresce a partir do livro, nao do centro do cartao.
    root.style.transformOrigin = `${Math.round(clamp(anchor.x - left, 0, box.width))}px ${Math.round(
      clamp(anchor.y - top, 0, box.height),
    )}px`;
  }

  /**
   * @param {object} rec
   * @param {{ x: number, y: number }} [at]  onde o usuario clicou
   * @param {{ editable?: boolean }} [opts]  `editable: false` e o modo leitura
   *   (estante de outra pessoa): o cartao sai sem "Editar" — a review, sim,
   *   aparece, e e o que se quer ver.
   */
  function show(rec, at, { editable = true } = {}) {
    root.replaceChildren();
    anchor = at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn details__close';
    close.setAttribute('aria-label', 'Fechar detalhes');
    close.append(icon('i-close'));
    close.addEventListener('click', () => {
      hide();
      onClose();
    });

    const top = document.createElement('div');
    top.className = 'details__top';

    if (rec.coverUrl) {
      const img = document.createElement('img');
      img.className = 'details__cover';
      img.src = rec.coverUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      // Se a capa falhar, ela some e o cartao encolhe: reposiciona.
      img.addEventListener('error', () => {
        img.remove();
        place();
      });
      top.append(img);
    }

    const text = document.createElement('div');

    const h = document.createElement('h3');
    h.textContent = rec.title;
    text.append(h);

    if (rec.author) {
      const a = document.createElement('p');
      a.className = 'details__author';
      a.textContent = rec.author;
      text.append(a);
    }

    text.append(renderStars(rec.rating ?? 0));

    const dates = document.createElement('p');
    dates.className = 'details__dates';
    const pages = rec.pages ? ` · ${rec.pages} páginas` : '';
    dates.textContent = periodText(rec) + pages;
    text.append(dates);

    top.append(text);
    root.append(close, top);

    if (rec.review?.trim()) {
      const review = document.createElement('p');
      review.className = 'details__review';
      review.textContent = rec.review;
      root.append(review);
    }

    if (editable) {
      const actions = document.createElement('div');
      actions.className = 'details__actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'details__edit';
      edit.append(icon('i-pencil'), document.createTextNode('Editar'));
      edit.addEventListener('click', () => onEdit(rec));
      actions.append(edit);
      root.append(actions);
    }

    // Precisa estar visivel para poder ser medido; como nada disto cede a thread,
    // nenhum frame chega a ser pintado na posicao errada.
    root.hidden = false;
    place();
  }

  // Girar o celular ou redimensionar a janela pode deixar o cartao fora da tela.
  window.addEventListener('resize', () => {
    if (!root.hidden) place();
  });

  return {
    show,
    hide,
    reposition: place,
    set onClose(fn) {
      onClose = fn;
    },
    set onEdit(fn) {
      onEdit = fn;
    },
    get isOpen() {
      return !root.hidden;
    },
  };
}
