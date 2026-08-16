/**
 * Chips numerados no topo-centro para escolher qual estante ver.
 *
 * So aparece quando existe mais de uma estante — ou seja, depois que as 6
 * prateleiras da primeira encheram. Como so a estante ativa existe na cena, o
 * paginador tambem e o que limita o uso de memoria de GPU: as texturas das
 * outras sao descartadas.
 */

export function createPager(root, onSelect) {
  let count = 0;
  let active = 0;

  function render() {
    root.replaceChildren();
    root.hidden = count <= 1;
    if (count <= 1) return;

    for (let i = 0; i < count; i++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(i === active));
      chip.tabIndex = i === active ? 0 : -1;
      chip.textContent = String(i + 1);
      chip.setAttribute('aria-label', `Estante ${i + 1}`);
      chip.addEventListener('click', () => select(i));
      chip.addEventListener('keydown', onKeydown);
      root.append(chip);
    }
  }

  function onKeydown(e) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (active + dir + count) % count;
    select(next);
    root.children[next]?.focus();
  }

  function select(i) {
    if (i === active) return;
    active = i;
    render();
    onSelect(i);
  }

  return {
    /** @param {number} n numero de estantes @param {number} current ativa */
    update(n, current) {
      count = n;
      active = Math.min(current, Math.max(0, n - 1));
      render();
    },
    get active() {
      return active;
    },
  };
}
