import { request, ApiError } from './api.js';

/**
 * Usuario da sessao, ou `null` quando NAO ha sessao (401). Qualquer outro
 * erro — servidor fora, 503 do banco — sobe: e o `main.js` que decide entre a
 * tela de entrada (visitante) e o toast (servidor com problema), e ele precisa
 * dos dois casos separados. Quem so quer "tem alguem?" (a splash) ja engole a
 * rejeicao por conta propria.
 *
 * @returns {Promise<{ _id: string, email: string, name: string, picture: string|null,
 *   handle: string, role: 'admin'|'user', nickname: string|null,
 *   gender: 'm'|'f'|null }|null>}
 */
export async function me() {
  try {
    return await request('/api/v1/users/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Encerra a sessao no servidor e apaga o cookie. Quem chama recarrega a pagina. */
export const logout = () => request('/auth/logout', { method: 'POST' });
