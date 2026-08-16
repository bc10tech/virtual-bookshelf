/**
 * Nota de 0 a 5.
 *
 * Sao radios nativos escondidos com <label>s por cima: um radiogroup de verdade
 * ja da navegacao por setas, agrupamento e semantica de leitor de tela de
 * graca. Reimplementar isso com divs e tabindex custaria mais codigo e seria
 * pior.
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

/**
 * @param {HTMLElement} root
 * @returns {{ value: number, reset(): void }}
 */
export function createStars(root) {
  let value = 0;
  const labels = [];

  for (let i = 1; i <= 5; i++) {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'rating';
    input.id = `star-${i}`;
    input.value = String(i);
    input.setAttribute('aria-label', i === 1 ? '1 estrela' : `${i} estrelas`);

    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.append(starSvg());

    input.addEventListener('change', () => set(i));

    root.append(input, label);
    labels.push(label);
  }

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'stars__clear';
  clear.textContent = 'Limpar';
  // Mais limpo que uma sexta estrela "zero", que confundiria a contagem.
  clear.addEventListener('click', () => set(0));
  root.append(clear);

  function set(v) {
    value = v;
    labels.forEach((l, i) => l.classList.toggle('is-on', i < v));
    const checked = root.querySelector(`#star-${v}`);
    if (checked) checked.checked = true;
    else root.querySelectorAll('input').forEach((i) => (i.checked = false));
  }

  set(0);

  return {
    get value() {
      return value;
    },
    set value(v) {
      set(Math.max(0, Math.min(5, Number(v) || 0)));
    },
    reset: () => set(0),
  };
}

/** Cinco estrelas somente leitura, para o cartao de detalhes. */
export function renderStars(rating) {
  const wrap = document.createElement('div');
  wrap.className = 'details__stars';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', rating ? `${rating} de 5 estrelas` : 'Sem nota');
  for (let i = 1; i <= 5; i++) {
    const s = starSvg(i <= rating ? 'is-on' : '');
    wrap.append(s);
  }
  return wrap;
}
