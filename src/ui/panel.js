import { UI, BOOK, uid } from '../config.js';
import { searchDebounced, cancelSearch } from '../data/search.js';
import { createStars } from './stars.js';

/**
 * O painel expansivel do canto superior direito.
 *
 * Sao dois elementos, nao um: o FAB (52x52, cantos arredondados) e o painel.
 * Ao abrir, o FAB some e o painel cresce a partir do canto dele — como e so
 * transform + opacity com origem em 100% 0, a transicao e 100% compositor
 * (zero layout, zero repaint) e le exatamente como o quadradinho virando
 * retangulo. Animar width/height num unico elemento faria reflow de toda a
 * arvore do formulario a cada frame.
 */

const $ = (id) => document.getElementById(id);

export function createPanel({ onSubmit }) {
  const fab = $('fab');
  const panel = $('panel');
  const form = $('book-form');
  const q = $('q');
  const ac = $('ac');
  const chosen = $('chosen');
  const searchMsg = $('search-msg');
  const pagesField = $('pages-field');
  const pages = $('pages');
  const start = $('start');
  const end = $('end');
  const review = $('review');
  const formMsg = $('form-msg');
  const confirm = $('confirm');

  const stars = createStars($('stars'));

  /** @type {null | {title,author,coverUrl,pages,olKey,isbn,manual}} */
  let selection = null;
  let options = [];
  let highlighted = -1;
  let isOpen = false;

  // Ler um livro no futuro nao faz sentido.
  start.max = new Date().toISOString().slice(0, 10);

  // ------------------------------------------------------------ abrir/fechar ---

  function open() {
    if (isOpen) return;
    isOpen = true;
    panel.inert = false;
    panel.classList.add('is-open');
    fab.classList.add('is-hidden');
    fab.setAttribute('aria-expanded', 'true');
    q.focus();
  }

  function close({ returnFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    fab.classList.remove('is-hidden');
    fab.setAttribute('aria-expanded', 'false');
    closeList();
    cancelSearch();
    if (returnFocus) fab.focus();

    // `inert` so depois da transicao: aplicado antes, o painel sumiria de
    // imediato em vez de encolher. `hidden` teria o mesmo problema.
    const done = () => {
      if (!isOpen) panel.inert = true;
      panel.removeEventListener('transitionend', done);
    };
    panel.addEventListener('transitionend', done);
  }

  fab.addEventListener('click', open);
  $('panel-close').addEventListener('click', () => close());
  $('cancel').addEventListener('click', () => {
    reset();
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen) return;
    if (!ac.hidden) closeList();
    else close();
  });

  panel.inert = true;

  // ------------------------------------------------------------ autocomplete ---

  function closeList() {
    ac.hidden = true;
    ac.replaceChildren();
    q.setAttribute('aria-expanded', 'false');
    q.removeAttribute('aria-activedescendant');
    highlighted = -1;
    options = [];
  }

  function highlight(i) {
    const items = [...ac.children];
    items.forEach((el, k) => el.setAttribute('aria-selected', String(k === i)));
    highlighted = i;
    if (i >= 0) {
      q.setAttribute('aria-activedescendant', items[i].id);
      items[i].scrollIntoView({ block: 'nearest' });
    } else {
      q.removeAttribute('aria-activedescendant');
    }
  }

  function renderList(results, typed) {
    // A ultima opcao e SEMPRE a entrada manual: o usuario vai ler coisas que a
    // Open Library nao tem, e sem essa saida o formulario seria um beco sem saida.
    options = [...results, { manual: true, title: typed }];

    ac.replaceChildren();
    options.forEach((o, i) => {
      const li = document.createElement('li');
      li.id = `ac-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      if (o.manual) {
        const span = document.createElement('span');
        span.className = 'ac__manual';
        span.textContent = `Cadastrar “${typed}” manualmente`;
        li.append(span);
      } else {
        if (o.coverUrl) {
          const img = document.createElement('img');
          img.src = o.coverUrl;
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.addEventListener('error', () => {
            const ph = document.createElement('div');
            ph.className = 'ac__thumb--empty';
            img.replaceWith(ph);
          });
          li.append(img);
        } else {
          const ph = document.createElement('div');
          ph.className = 'ac__thumb--empty';
          li.append(ph);
        }

        const text = document.createElement('div');
        text.className = 'ac__text';
        const t = document.createElement('span');
        t.className = 'ac__title';
        t.textContent = o.title;
        const m = document.createElement('span');
        m.className = 'ac__meta';
        m.textContent = [o.author, o.year, o.pages ? `${o.pages} p.` : null]
          .filter(Boolean)
          .join(' · ');
        text.append(t, m);
        li.append(text);
      }

      li.addEventListener('mousedown', (e) => e.preventDefault()); // nao rouba o foco do input
      li.addEventListener('click', () => choose(i));
      ac.append(li);
    });

    ac.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    highlight(-1);
  }

  function choose(i) {
    const o = options[i];
    if (!o) return;

    selection = o.manual
      ? { title: o.title.trim(), author: '', coverUrl: null, pages: null, olKey: null, isbn: null, manual: true }
      : {
          title: o.title,
          author: o.author,
          coverUrl: o.coverUrl,
          pages: o.pages,
          olKey: o.key,
          isbn: o.isbn,
          manual: false,
        };

    q.value = selection.title;
    closeList();
    showChosen();
    (selection.manual ? pages : start).focus();
  }

  function showChosen() {
    if (!selection) {
      chosen.hidden = true;
      pagesField.hidden = true;
      return;
    }
    // Quando a obra nao informa contagem de paginas, o campo manual aparece:
    // e ela que define a espessura da lombada.
    pagesField.hidden = !!selection.pages;
    const bits = [
      selection.author || (selection.manual ? 'cadastro manual' : 'autor desconhecido'),
      selection.pages ? `${selection.pages} páginas` : null,
      selection.coverUrl ? 'capa encontrada' : 'capa gerada',
    ].filter(Boolean);
    chosen.textContent = bits.join(' · ');
    chosen.hidden = false;
  }

  q.addEventListener('input', () => {
    selection = null;
    chosen.hidden = true;
    pagesField.hidden = true;
    searchMsg.hidden = true;

    const term = q.value.trim();
    if (term.length < UI.SEARCH_MIN_CHARS) {
      cancelSearch();
      closeList();
      return;
    }
    searchDebounced(
      term,
      (results) => {
        if (q.value.trim() === term) renderList(results, term);
      },
      (err) => {
        searchMsg.textContent = err.message;
        searchMsg.hidden = false;
        renderList([], term); // a entrada manual continua disponivel
      },
    );
  });

  q.addEventListener('keydown', (e) => {
    if (ac.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight((highlighted + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight((highlighted - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      choose(highlighted);
    }
  });

  q.addEventListener('blur', () => setTimeout(closeList, 120));

  // Fim nunca antes do inicio — o proprio browser passa a impedir.
  start.addEventListener('change', () => {
    end.min = start.value || '';
  });

  // ----------------------------------------------------------------- submit ---

  function reset() {
    form.reset();
    stars.reset();
    selection = null;
    chosen.hidden = true;
    pagesField.hidden = true;
    searchMsg.hidden = true;
    formMsg.hidden = true;
    closeList();
  }

  function fail(msg, el) {
    formMsg.textContent = msg;
    formMsg.hidden = false;
    el?.focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formMsg.hidden = true;

    if (!selection) {
      return fail('Escolha um livro na lista ou use a opção de cadastro manual.', q);
    }
    if (!start.value) return fail('Informe quando você começou a ler.', start);
    if (end.value && end.value < start.value) {
      return fail('A data de término não pode ser anterior à de início.', end);
    }

    const manualPages = Number.parseInt(pages.value, 10);
    const record = {
      id: uid(),
      title: selection.title,
      author: selection.author || '',
      pages: selection.pages ?? (Number.isFinite(manualPages) ? manualPages : BOOK.DEFAULT_PAGES),
      coverUrl: selection.coverUrl,
      olKey: selection.olKey,
      isbn: selection.isbn,
      startDate: start.value,
      endDate: end.value || null,
      rating: stars.value,
      review: review.value.trim(),
    };

    confirm.disabled = true;
    try {
      await onSubmit(record);
      reset();
      close({ returnFocus: false });
    } catch (err) {
      fail(err.message || 'Não consegui salvar. Tente de novo.');
    } finally {
      confirm.disabled = false;
    }
  });

  return { open, close, reset, get isOpen() { return isOpen; } };
}
