import { request, json, list } from './api.js';

/**
 * Os outros usuarios — a parte "amigos" do item 4. Leitura de estante alheia
 * so existe por aqui, e so logado (o servidor resolve o dono pelo handle).
 */

const BASE = '/api/v1/users';

/**
 * Todo mundo, com o resumo da estante de cada um. Inclui quem pergunta; a lista
 * de amigos filtra pelo proprio `handle`.
 *
 * @returns {Promise<{ year: number, items: Array<{ handle: string, name: string,
 *   picture: string|null, nickname: string|null, total: number,
 *   readThisYear: number, reading: { title: string }|null }> }>}
 */
export const listUsers = () => request(BASE);

/** A estante de `handle`, inteira e na ordem dela — mesmo laco do `api.list()`. 404 se nao existe. */
export const booksOf = (handle) => list(`${BASE}/${encodeURIComponent(handle)}/books`);

/**
 * `PATCH /users/me` com `{ nickname?, gender?, handle? }`. Devolve o usuario
 * inteiro, no formato de `me()` — quem chama substitui o seu por ele.
 */
export const updateMe = (patch) => request(`${BASE}/me`, json(patch, 'PATCH'));
