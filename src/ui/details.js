import { renderStars } from './stars.js';

/**
 * Cartao somente leitura do livro clicado na estante.
 *
 * Toda string vinda do usuario ou da Open Library entra por `textContent`.
 * `innerHTML` e proibido neste codigo: a review e texto livre e vai voltar do
 * banco intacta, entao esta e a unica barreira contra XSS — e ela precisa valer
 * tambem quando o login da fase 2 fizer uma estante ser vista por outra pessoa.
 */

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

  function hide() {
    root.hidden = true;
    root.replaceChildren();
  }

  function show(rec) {
    root.replaceChildren();
    root.hidden = false;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn details__close';
    close.setAttribute('aria-label', 'Fechar detalhes');
    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('class', 'icon');
    closeIcon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-close');
    closeIcon.append(use);
    close.append(closeIcon);
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
      img.addEventListener('error', () => img.remove());
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
  }

  return {
    show,
    hide,
    set onClose(fn) {
      onClose = fn;
    },
    get isOpen() {
      return !root.hidden;
    },
  };
}
