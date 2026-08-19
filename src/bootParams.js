import { authFlagFromSearch } from './ui/gate.js';

/**
 * Tudo o que a URL pode dizer ao boot, lido UMA vez:
 *
 * - `?auth=`           o servidor voltou do login com um aviso (gate.js);
 * - `?welcome=1&nome=` primeiro login — o Perfil abre sozinho com `nome` como
 *                      sugestao de apelido (vem do `given_name` do Google);
 * - `?u=<handle>`      abrir direto a estante de outra pessoa.
 *
 * O `main.js` le isto e apaga a query inteira com `replaceState`: um F5 nao
 * repete o aviso nem reabre o Perfil. O `?u=` e reescrito pelo proprio modo
 * leitura ao entrar — assim a URL tem uma unica fonte, e F5 na estante de um
 * amigo volta para a mesma estante.
 *
 * Pura e testada. O handle e so saneado aqui (minusculas, sem lixo grosseiro);
 * a regra exata e `HANDLE_RE` no servidor, que responde 404 para o que nao
 * existe.
 */

// Folga sobre o `MAX.nickname` (40) e o `MAX.handle` (32) do servidor: o que
// passar daqui e lixo, nao um nome.
const NAME_MAX = 40;
const HANDLE_MAX = 32;
const HANDLE_SANE = /^[a-z0-9-]+$/;

/**
 * @param {string} search  `location.search`, com o `?`
 * @returns {{
 *   auth: ReturnType<typeof authFlagFromSearch>,
 *   welcome: { name: string } | null,
 *   owner: string | null,
 * }}
 */
export function bootParams(search) {
  const params = new URLSearchParams(search ?? '');

  let welcome = null;
  if (params.get('welcome') === '1') {
    const name = (params.get('nome') ?? '').trim().slice(0, NAME_MAX);
    welcome = { name };
  }

  let owner = null;
  const u = (params.get('u') ?? '').trim().toLowerCase();
  if (u && u.length <= HANDLE_MAX && HANDLE_SANE.test(u)) owner = u;

  return { auth: authFlagFromSearch(search), welcome, owner };
}
