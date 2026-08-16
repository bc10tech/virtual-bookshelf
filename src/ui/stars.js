/**
 * Nota de 0 a 5, em passos de meio ponto.
 *
 * Sao 10 radios nativos escondidos (0,5 a 5,0) com <label>s por cima: um
 * radiogroup de verdade ja da navegacao por setas — que agora anda de meio em
 * meio ponto de graca —, agrupamento e semantica de leitor de tela.
 *
 * Cada estrela e um slot de 48 px com duas metades clicaveis de 24 px, que e o
 * alvo minimo aceitavel para toque. O preenchimento pela metade e um
 * `clip-path` sobre uma copia da estrela, sem nenhum SVG novo.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function starSvg(cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-star');
  svg.append(use);
  return svg;
}

/** Estado visual de uma estrela para uma nota: 0, 0.5 ou 1. */
const fillOf = (rating, index) =>
  rating >= index + 1 ? 1 : rating >= index + 0.5 ? 0.5 : 0;

/** Um slot de estrela: fundo apagado + copia preenchida recortada por CSS. */
function starSlot(fill, extraClass = '') {
  const slot = document.createElement('span');
  slot.className =
    'star' +
    (extraClass ? ` ${extraClass}` : '') +
    (fill === 1 ? ' is-full' : fill === 0.5 ? ' is-half' : '');
  slot.append(starSvg('star__bg'), starSvg('star__fill'));
  return slot;
}

/** "3,5" / "4" / "—" */
export const formatRating = (v) =>
  !v ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');

const ariaFor = (v) =>
  v === 0.5 ? 'meia estrela' : v === 1 ? '1 estrela' : `${formatRating(v)} estrelas`;

/**
 * @param {HTMLElement} root
 * @returns {{ value: number, reset(): void }}
 */
export function createStars(root) {
  let value = 0;

  const row = document.createElement('div');
  row.className = 'stars__row';

  const slots = [];

  for (let i = 0; i < 5; i++) {
    const slot = starSlot(0);

    // Metade esquerda = x,5 ; metade direita = x+1. Os inputs ficam dentro do
    // slot para o seletor `input:focus-visible + label` continuar valendo.
    for (const [half, side] of [
      [i + 0.5, 'l'],
      [i + 1, 'r'],
    ]) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'rating';
      input.id = `star-${String(half).replace('.', '_')}`;
      input.value = String(half);
      input.setAttribute('aria-label', ariaFor(half));
      input.addEventListener('change', () => set(half));

      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.className = `star__half star__half--${side}`;

      slot.append(input, label);
    }

    row.append(slot);
    slots.push(slot);
  }

  const readout = document.createElement('span');
  readout.className = 'stars__value';
  readout.setAttribute('aria-hidden', 'true'); // os radios ja anunciam a nota

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'stars__clear';
  clear.textContent = 'Limpar';
  // Mais limpo que uma "estrela zero", que confundiria a contagem.
  clear.addEventListener('click', () => set(0));

  root.append(row, readout, clear);

  function set(v) {
    value = v;
    slots.forEach((slot, i) => {
      const fill = fillOf(v, i);
      slot.classList.toggle('is-full', fill === 1);
      slot.classList.toggle('is-half', fill === 0.5);
    });
    readout.textContent = formatRating(v);

    for (const input of root.querySelectorAll('input[name="rating"]')) {
      input.checked = Number(input.value) === v;
    }
  }

  set(0);

  return {
    get value() {
      return value;
    },
    set value(v) {
      // Arredonda para o meio ponto mais proximo: uma nota antiga inteira
      // continua valendo, e um valor estranho vindo do banco nao quebra nada.
      const n = Math.max(0, Math.min(5, Number(v) || 0));
      set(Math.round(n * 2) / 2);
    },
    reset: () => set(0),
  };
}

/** Cinco estrelas somente leitura, para o cartao de detalhes. */
export function renderStars(rating) {
  const wrap = document.createElement('div');
  wrap.className = 'details__stars';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute(
    'aria-label',
    rating ? `${formatRating(rating)} de 5 estrelas` : 'Sem nota',
  );
  for (let i = 0; i < 5; i++) wrap.append(starSlot(fillOf(rating, i), 'star--sm'));
  return wrap;
}
