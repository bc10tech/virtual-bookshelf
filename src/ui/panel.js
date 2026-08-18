import { UI, BOOK, uid } from '../config.js';
import { searchDebounced, cancelSearch } from '../data/search.js';
import { createStars } from './stars.js';

/**
 * O painel expansivel do canto superior direito, em dois modos: adicionar e
 * editar.
 *
 * Sao dois elementos, nao um: o FAB (52x52, cantos arredondados) e o painel.
 * Ao abrir, o FAB some e o painel cresce a partir do canto dele — como e so
 * transform + opacity com origem em 100% 0, a transicao e 100% compositor
 * (zero layout, zero repaint) e le exatamente como o quadradinho virando
 * retangulo. Animar width/height num unico elemento faria reflow de toda a
 * arvore do formulario a cada frame.
 */

const $ = (id) => document.getElementById(id);

export function createPanel({ onSubmit, onUpdate, onDelete, onOpen, onChoose }) {
  const fab = $('fab');
  const panel = $('panel');
  const panelTitle = $('panel-title');
  const form = $('book-form');
  const q = $('q');
  const ac = $('ac');
  const chosen = $('chosen');
  const searchMsg = $('search-msg');
  const pagesField = $('pages-field');
  const pages = $('pages');
  const pagesHint = $('pages-hint');
  const start = $('start');
  const end = $('end');
  const review = $('review');
  const formMsg = $('form-msg');
  const confirmBtn = $('confirm');
  const deleteBtn = $('delete');

  const stars = createStars($('stars'));

  /**
   * @type {null | {title,author,coverUrl,pages,olKey,isbn,manual,pagesLocked}}
   */
  let selection = null;
  let options = [];
  let highlighted = -1;
  let isOpen = false;
  /** Registro sendo editado, ou null no modo adicionar. */
  let editing = null;
  /** Excluir armado: o proximo clique apaga de verdade. */
  let armed = false;

  // Ler um livro no futuro nao faz sentido.
  start.max = new Date().toISOString().slice(0, 10);

  // ------------------------------------------------------------ abrir/fechar ---

  function open() {
    if (isOpen) return;
    // O cartao de detalhes fica ACIMA do painel (z-index 45 contra 40, para nao
    // ser encoberto pelos botoes de canto), entao ele precisa sair de cena antes
    // — senao cobriria o formulario.
    onOpen?.();
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
    setMode(null);
    if (returnFocus) fab.focus();

    // `inert` so depois da transicao: aplicado antes, o painel sumiria de
    // imediato em vez de encolher. `hidden` teria o mesmo problema.
    const done = () => {
      if (!isOpen) panel.inert = true;
      panel.removeEventListener('transitionend', done);
    };
    panel.addEventListener('transitionend', done);
  }

  /** Alterna entre "Adicionar livro" e "Editar livro". */
  function setMode(rec) {
    editing = rec;
    panelTitle.textContent = rec ? 'Editar livro' : 'Adicionar livro';
    confirmBtn.textContent = rec ? 'Salvar' : 'Confirmar';
    deleteBtn.hidden = !rec;
    disarmDelete();
  }

  fab.addEventListener('click', () => {
    reset();
    open();
  });
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
      ? {
          title: o.title.trim(),
          author: '',
          coverUrl: null,
          pages: null,
          olKey: null,
          isbn: null,
          manual: true,
          pagesLocked: false,
        }
      : {
          title: o.title,
          author: o.author,
          coverUrl: o.coverUrl,
          pages: o.pages,
          olKey: o.key,
          isbn: o.isbn,
          manual: false,
          // Se a obra informou a contagem, ela manda: reescrever esse numero a
          // mao so faria o livro mentir sobre a propria espessura.
          pagesLocked: o.pages != null,
        };

    q.value = selection.title;
    closeList();
    showChosen();
    (selection.pagesLocked ? start : pages).focus();
    // A pessoa ainda vai preencher datas, nota e review: e tempo de sobra para
    // as capas baixarem antes do cadastro (ver `warmCover` em cover.js).
    onChoose?.(selection);
  }

  function showChosen() {
    if (!selection) {
      chosen.hidden = true;
      pages.readOnly = false;
      pagesHint.textContent = 'Define a espessura do livro na estante.';
      return;
    }

    pages.readOnly = selection.pagesLocked;
    if (selection.pages != null) pages.value = String(selection.pages);
    pagesHint.textContent = selection.pagesLocked
      ? 'Informado pela Open Library. Define a espessura do livro na estante.'
      : 'Define a espessura do livro na estante.';

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
    searchMsg.hidden = true;
    pages.readOnly = false;

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

  // ----------------------------------------------------------------- excluir ---

  function disarmDelete() {
    armed = false;
    deleteBtn.classList.remove('is-arming');
    deleteBtn.textContent = 'Excluir';
  }

  deleteBtn.addEventListener('click', async () => {
    if (!editing) return;

    // Exclusao e irreversivel: um clique acidental num botao vermelho nao pode
    // apagar uma leitura registrada. O primeiro clique so arma.
    if (!armed) {
      armed = true;
      deleteBtn.classList.add('is-arming');
      deleteBtn.textContent = 'Confirmar exclusão';
      return;
    }

    deleteBtn.disabled = true;
    try {
      await onDelete(editing._id);
      reset();
      close({ returnFocus: false });
    } catch (err) {
      fail(err.message || 'Não consegui excluir. Tente de novo.');
      disarmDelete();
    } finally {
      deleteBtn.disabled = false;
    }
  });

  // Qualquer outro toque no formulario desarma: o estado armado nao fica
  // esperando um clique distraido mais tarde.
  panel.addEventListener('focusin', (e) => {
    if (armed && e.target !== deleteBtn) disarmDelete();
  });
  form.addEventListener('input', () => {
    if (armed) disarmDelete();
  });

  // ------------------------------------------------------------------ submit ---

  function reset() {
    form.reset();
    stars.reset();
    selection = null;
    chosen.hidden = true;
    searchMsg.hidden = true;
    formMsg.hidden = true;
    pages.readOnly = false;
    pagesHint.textContent = 'Define a espessura do livro na estante.';
    closeList();
    setMode(null);
  }

  function fail(msg, el) {
    formMsg.textContent = msg;
    formMsg.hidden = false;
    el?.focus();
  }

  /** Abre o painel ja preenchido com um registro existente. */
  function openForEdit(rec) {
    reset();

    selection = {
      title: rec.title,
      author: rec.author || '',
      coverUrl: rec.coverUrl || null,
      pages: rec.pages ?? null,
      olKey: rec.olKey || null,
      isbn: rec.isbn || null,
      manual: !rec.olKey,
      // Livro cadastrado a mao continua editavel; vindo da Open Library, nao.
      pagesLocked: Boolean(rec.olKey && rec.pages),
    };

    q.value = rec.title;
    pages.value = rec.pages ?? '';
    start.value = rec.startDate ?? '';
    end.value = rec.endDate ?? '';
    end.min = rec.startDate ?? '';
    stars.value = rec.rating ?? 0;
    review.value = rec.review ?? '';

    showChosen();
    setMode(rec);
    open();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formMsg.hidden = true;
    disarmDelete();

    if (!selection) {
      return fail('Escolha um livro na lista ou use a opção de cadastro manual.', q);
    }
    if (!start.value) return fail('Informe quando você começou a ler.', start);
    if (end.value && end.value < start.value) {
      return fail('A data de término não pode ser anterior à de início.', end);
    }

    const typed = Number.parseInt(pages.value, 10);
    const fields = {
      title: selection.title,
      author: selection.author || '',
      pages: selection.pagesLocked
        ? selection.pages
        : Number.isFinite(typed) && typed > 0
          ? typed
          : (selection.pages ?? BOOK.DEFAULT_PAGES),
      coverUrl: selection.coverUrl,
      olKey: selection.olKey,
      isbn: selection.isbn,
      startDate: start.value,
      endDate: end.value || null,
      rating: stars.value,
      review: review.value.trim(),
    };

    confirmBtn.disabled = true;
    try {
      if (editing) await onUpdate(editing._id, fields);
      else await onSubmit({ id: uid(), ...fields });
      reset();
      close({ returnFocus: false });
    } catch (err) {
      fail(err.message || 'Não consegui salvar. Tente de novo.');
    } finally {
      confirmBtn.disabled = false;
    }
  });

  return {
    open,
    openForEdit,
    close,
    reset,
    get isOpen() {
      return isOpen;
    },
  };
}
