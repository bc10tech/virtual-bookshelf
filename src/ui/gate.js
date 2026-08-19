/**
 * A tela de entrada — o que o visitante ve depois da splash. E markup estatico
 * no `index.html` (como a splash): o unico texto dinamico e o aviso, e ele vai
 * por `textContent`. O botao e um `<a href="/auth/google">`: nenhum script do
 * Google no cliente, e por isso funciona em qualquer browser de celular sem
 * popup bloqueado.
 *
 * O servidor volta do login com um `?auth=` na URL quando algo nao deu certo;
 * `authFlagFromSearch` le isso (pura, testada) e o `main.js` limpa a URL.
 */

const REASONS = new Set(['nao-convidado', 'cancelado', 'erro']);

/**
 * `'?auth=nao-convidado&email=a%40b.c'` -> `{ reason, email }`; sem `auth` ou
 * com valor desconhecido -> `null`.
 *
 * @param {string} search  `location.search`, com o `?`
 * @returns {{ reason: 'nao-convidado'|'cancelado'|'erro', email: string|null }|null}
 */
export function authFlagFromSearch(search) {
  const params = new URLSearchParams(search ?? '');
  const reason = params.get('auth');
  if (!reason || !REASONS.has(reason)) return null;
  const email = params.get('email');
  return { reason, email: email ? email.trim().toLowerCase() : null };
}

const MESSAGES = {
  'nao-convidado': (email) =>
    `Sua conta ainda não foi convidada${email ? ` (${email})` : ''}. ` +
    'Peça um convite a quem já usa a estante.',
  cancelado: () => 'Login cancelado.',
  erro: () => 'Não consegui concluir o login. Tente de novo.',
};

/**
 * @param {HTMLElement} root  a `<section id="gate">`
 */
export function createGate(root) {
  const msg = root.querySelector('#gate-msg');

  return {
    /** Mostra a tela; `flag` e o retorno de `authFlagFromSearch`. */
    show(flag) {
      if (flag) {
        msg.textContent = MESSAGES[flag.reason](flag.email);
        msg.hidden = false;
      }
      root.hidden = false;
    },
  };
}
