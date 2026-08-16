import { SORTS } from '../data/sort.js';

/**
 * Canto inferior esquerdo, em dois estagios: o botao de icone revela o botao
 * "Ordenar por", que abre o popover com os criterios.
 *
 * O popover cresce para cima a partir do canto, entao nunca cobre o centro da
 * tela — que e onde a estante esta.
 */
export function createSortMenu({ toggle, pill, menu, getSort, onSelect }) {
  let itemsOpen = false;
  let menuOpen = false;

  function showActions(on) {
    itemsOpen = on;
    pill.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (!on) showMenu(false);
  }

  function showMenu(on) {
    menuOpen = on;
    menu.hidden = !on;
    pill.setAttribute('aria-expanded', String(on));
    if (on) {
      render();
      (menu.querySelector('[aria-checked="true"]') ?? menu.firstElementChild)?.focus();
    }
  }

  function render() {
    const sort = getSort();
    menu.replaceChildren();

    for (const option of SORTS) {
      const active = option.id === sort.by;

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sortmenu__item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(active));
      item.tabIndex = -1;

      const label = document.createElement('span');
      label.textContent = option.label;
      item.append(label);

      // A direcao so aparece no criterio ativo: nos outros seria um palpite
      // sobre o que aconteceria, e nao um estado.
      if (active) {
        const dir = document.createElement('span');
        dir.className = 'sortmenu__dir';
        dir.textContent = sort.dir === 'desc' ? option.desc : option.asc;
        item.append(dir);
        item.title = 'Clique de novo para inverter';
      }

      item.addEventListener('click', () => {
        const current = getSort();
        // Clicar no criterio ja ativo inverte a direcao; noutro, comeca em asc.
        const next =
          current.by === option.id
            ? { by: option.id, dir: current.dir === 'asc' ? 'desc' : 'asc' }
            : { by: option.id, dir: 'asc' };
        onSelect(next);
        render();
        menu.querySelector('[aria-checked="true"]')?.focus();
      });

      item.addEventListener('keydown', onKeydown);
      menu.append(item);
    }
  }

  function onKeydown(e) {
    const items = [...menu.children];
    const i = items.indexOf(e.currentTarget);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1].focus();
    }
  }

  toggle.addEventListener('click', () => showActions(!itemsOpen));
  pill.addEventListener('click', () => showMenu(!menuOpen));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuOpen) {
      showMenu(false);
      pill.focus();
    } else if (itemsOpen) {
      showActions(false);
      toggle.focus();
    }
  });

  // Clique fora fecha os dois estagios.
  document.addEventListener('pointerdown', (e) => {
    if (!itemsOpen) return;
    if (toggle.parentElement.contains(e.target)) return;
    showActions(false);
  });

  return {
    close: () => showActions(false),
    refresh: () => menuOpen && render(),
  };
}
