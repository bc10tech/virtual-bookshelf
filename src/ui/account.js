/**
 * Canto superior esquerdo: o botao de conta abre um menu com quem esta logado,
 * "Convidar" (so admin) e "Sair". Mesmo padrao do `sortMenu.js` — `hidden` +
 * `aria-expanded`, foco movido a mao entre `role="menuitem"`, Escape devolve o
 * foco ao botao, toque fora fecha —, so que num estagio, e crescendo para
 * baixo.
 *
 * Nome e e-mail vao ao DOM por `textContent`: vem do Google, mas a regra e a
 * mesma para todo texto que nao e nosso.
 */
export function createAccountMenu({ toggle, menu, user, onInvite, onLogout }) {
  let open = false;

  function show(on) {
    open = on;
    menu.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (on) {
      render();
      menu.querySelector('[role="menuitem"]')?.focus();
    }
  }

  function item(label, icon, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'menu__item';
    el.setAttribute('role', 'menuitem');
    el.tabIndex = -1;

    const text = document.createElement('span');
    text.textContent = label;
    el.append(text);

    if (icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#${icon}`);
      svg.append(use);
      el.append(svg);
    }

    el.addEventListener('click', () => {
      show(false);
      onClick();
    });
    el.addEventListener('keydown', onKeydown);
    return el;
  }

  function render() {
    menu.replaceChildren();

    const who = document.createElement('div');
    who.className = 'menu__who';
    const name = document.createElement('span');
    name.className = 'menu__name';
    name.textContent = user.name || user.handle;
    const email = document.createElement('span');
    email.className = 'menu__email';
    email.textContent = user.email;
    who.append(name, email);
    menu.append(who);

    if (user.role === 'admin') menu.append(item('Convidar', 'i-plus', onInvite));
    menu.append(item('Sair', 'i-logout', onLogout));
  }

  function onKeydown(e) {
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
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

  toggle.addEventListener('click', () => show(!open));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    show(false);
    toggle.focus();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!open) return;
    if (toggle.parentElement.contains(e.target)) return;
    show(false);
  });

  return { close: () => show(false) };
}
