import { UI } from '../config.js';

/**
 * Modo claro e escuro.
 *
 * O tema vive num atributo do <html>, entao todo o CSS troca por tokens. A cena
 * 3D so muda a cor de FUNDO: os materiais da estante e dos livros sao os mesmos
 * objetos nos dois modos, e as luzes tambem — a madeira nao deveria mudar de
 * cor porque a interface mudou.
 *
 * Quem nunca escolheu recebe UI.DEFAULT_THEME (escuro), e NAO a preferencia do
 * sistema: o app tem uma cara, e o outro modo e a alternativa. O index.html ja
 * nasce com `data-theme` e os <meta> desse tema, para a primeira pintura nao
 * piscar antes deste modulo rodar.
 */

const KEY = 'vb.theme';

const read = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // localStorage bloqueado: fica no padrao
  }
};

const write = (v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // nao persistir nao pode impedir a troca
  }
};

/**
 * @param {HTMLButtonElement} button
 * @param {(theme: 'light'|'dark') => void} onChange
 */
export function createTheme(button, onChange) {
  const icon = button.querySelector('use');
  const meta = document.querySelector('meta[name="theme-color"]');

  /** null = nunca escolheu. */
  let explicit = read();

  const resolved = () => explicit ?? UI.DEFAULT_THEME;

  function apply() {
    const theme = resolved();
    const root = document.documentElement;

    root.dataset.theme = theme;
    // Faz o browser desenhar barras de rolagem e controles nativos no tom certo.
    root.style.colorScheme = theme;

    icon?.setAttribute('href', theme === 'dark' ? '#i-moon' : '#i-sun');
    button.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Mudar para o modo claro' : 'Mudar para o modo escuro',
    );
    button.title = button.getAttribute('aria-label');

    if (meta) {
      meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || meta.content;
    }

    onChange(theme);
  }

  button.addEventListener('click', () => {
    explicit = resolved() === 'dark' ? 'light' : 'dark';
    write(explicit);
    apply();
  });

  apply();

  return {
    get theme() {
      return resolved();
    },
  };
}
