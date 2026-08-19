/**
 * A casca dos dialogos do canto superior esquerdo — Convidar, Perfil e Amigos.
 * E a mesma mecanica do painel de cadastro (`.panel`, `.is-open` + `inert`,
 * sheet no celular), aberta a partir do botao da conta. Os tres ocupam
 * exatamente o mesmo lugar na tela, entao quem os cria precisa fechar os
 * outros no `onOpen` — a casca nao sabe dos irmaos de proposito.
 *
 * @param {HTMLElement} root  o `.panel.panel--left` estatico do `index.html`
 * @param {object} opts
 * @param {() => void} [opts.onOpen]        roda antes de abrir (fechar o resto)
 * @param {() => void} [opts.onOpened]      roda depois de abrir (carregar, focar)
 * @param {HTMLElement} [opts.closeButton]  o `.icon-btn` do cabecalho
 * @param {HTMLElement} [opts.initialFocus] quem recebe o foco ao abrir
 */
export function createLeftDialog(root, { onOpen, onOpened, closeButton, initialFocus } = {}) {
  const corner = document.querySelector('.corner--top-left');
  let isOpen = false;

  function open() {
    if (isOpen) return;
    onOpen?.();
    isOpen = true;
    root.inert = false;
    root.classList.add('is-open');
    corner?.classList.add('is-hidden');
    initialFocus?.focus();
    onOpened?.();
  }

  function close({ returnFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('is-open');
    corner?.classList.remove('is-hidden');
    if (returnFocus) document.getElementById('account')?.focus();

    // `inert` so depois da transicao, como no painel: aplicado antes, o
    // dialogo sumiria de imediato em vez de encolher.
    const done = () => {
      if (!isOpen) root.inert = true;
      root.removeEventListener('transitionend', done);
    };
    root.addEventListener('transitionend', done);
  }

  closeButton?.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });

  root.inert = true;

  return {
    open,
    close,
    get isOpen() {
      return isOpen;
    },
  };
}
