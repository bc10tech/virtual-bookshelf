import { createLeftDialog } from './leftDialog.js';
import { shelfStats } from '../data/shelfStats.js';
import { renderStars, formatRating } from './stars.js';

/**
 * Dialogo de Estatisticas: os totais da estante a vista e as barras de lidos
 * por mes, ano a ano. Tudo calculado NO CLIENTE sobre o acervo ja carregado
 * (`shelfStats`, puro) — zero rota nova; em modo leitura os numeros sao da
 * estante do amigo, e o subtitulo diz de quem. Barras em CSS, sem biblioteca
 * de grafico. Casca em `leftDialog.js`.
 *
 * Titulo de livro nao aparece aqui, mas o nome do dono sim — `textContent`,
 * como sempre.
 */

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const num = (n) => n.toLocaleString('pt-BR');

export function createStatsDialog(root, { records, owner, onOpen }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const ownerEl = $('stats-owner');
  const body = $('stats-body');

  const dialog = createLeftDialog(root, {
    onOpen,
    onOpened: refresh,
    closeButton: $('stats-close'),
    initialFocus: $('stats-close'),
  });

  /** O resumo da abertura corrente e o ano em exibicao (indice em `years`). */
  let stats = null;
  let yearIdx = 0;

  function tile(label, value) {
    const el = document.createElement('div');
    el.className = 'stats__tile';
    const v = document.createElement('span');
    v.className = 'stats__value';
    v.textContent = value;
    const l = document.createElement('span');
    l.className = 'stats__label';
    l.textContent = label;
    el.append(v, l);
    return el;
  }

  function ratingRow() {
    const el = document.createElement('div');
    el.className = 'stats__rating';
    if (stats.avgRating == null) {
      el.classList.add('stats__rating--empty');
      el.textContent = 'nenhum livro avaliado ainda';
      return el;
    }
    const text = document.createElement('span');
    text.className = 'stats__rating-text';
    const n = stats.ratedCount;
    text.textContent = `nota média ${formatRating(stats.avgRating)} · ${n} ${n === 1 ? 'avaliado' : 'avaliados'}`;
    el.append(renderStars(stats.avgRating), text);
    return el;
  }

  function chart(year) {
    const el = document.createElement('div');
    el.className = 'stats__chart';
    const max = Math.max(...year.byMonth);
    year.byMonth.forEach((count, m) => {
      const col = document.createElement('div');
      col.className = 'stats__col';

      const n = document.createElement('span');
      n.className = 'stats__count';
      // O zero vira espaco em branco: doze zeros so fariam ruido sobre as barras.
      n.textContent = count ? String(count) : '';

      const bar = document.createElement('div');
      bar.className = 'stats__bar';
      bar.style.height = `${max ? (count / max) * 100 : 0}%`;

      const track = document.createElement('div');
      track.className = 'stats__track';
      track.append(bar);

      const label = document.createElement('span');
      label.className = 'stats__mon';
      label.textContent = MES_ABREV[m];

      col.append(n, track, label);
      el.append(col);
    });
    return el;
  }

  function yearSection() {
    const el = document.createElement('section');
    el.className = 'stats__year';

    if (!stats.years.length) {
      const p = document.createElement('p');
      p.className = 'stats__empty';
      p.textContent = 'Nenhum livro terminado ainda.';
      el.append(p);
      return el;
    }

    const year = stats.years[yearIdx];

    const head = document.createElement('div');
    head.className = 'stats__year-head';
    // `years` vem do mais recente para o mais antigo, entao "anterior" e
    // andar PARA FRENTE no array — os dois botoes refletem isso.
    const prev = navBtn('‹', `Ver ${year.year - 1}`, yearIdx + 1);
    const next = navBtn('›', `Ver ${year.year + 1}`, yearIdx - 1);
    const h = document.createElement('h3');
    h.textContent = String(year.year);
    head.append(prev, h, next);

    const meta = document.createElement('p');
    meta.className = 'stats__year-meta';
    meta.textContent = `${year.finished} ${year.finished === 1 ? 'lido' : 'lidos'} · ${num(year.pages)} páginas`;

    el.append(head, chart(year), meta);
    return el;
  }

  function navBtn(glyph, label, targetIdx) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stats__nav';
    btn.textContent = glyph;
    btn.setAttribute('aria-label', label);
    btn.disabled = targetIdx < 0 || targetIdx >= stats.years.length;
    btn.addEventListener('click', () => {
      yearIdx = targetIdx;
      render();
    });
    return btn;
  }

  function render() {
    body.replaceChildren();

    const grid = document.createElement('div');
    grid.className = 'stats__grid';
    grid.append(
      tile('lidos', String(stats.finished)),
      tile('lendo agora', String(stats.reading)),
      tile('páginas lidas', num(stats.pagesRead)),
      tile('tempo médio', stats.avgDays == null ? '—' : `${stats.avgDays} ${stats.avgDays === 1 ? 'dia' : 'dias'}`),
    );

    body.append(grid, ratingRow(), yearSection());
  }

  function refresh() {
    const person = owner();
    ownerEl.textContent = person ? `A estante de ${person.nickname || person.name || person.handle}` : '';
    ownerEl.hidden = !person;

    stats = shelfStats(records());
    yearIdx = 0; // toda abertura volta ao ano mais recente
    render();
  }

  return {
    open: dialog.open,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
  };
}
