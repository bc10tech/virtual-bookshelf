import { request } from './api.js';

/**
 * Usuario da sessao, ou `null`. Hoje a rota nao existe (o login e o item 3 do
 * `steps.md`) e o servidor responde 404 — por isso QUALQUER erro vira `null` em
 * vez de estourar: quem chama trata "sem usuario" como o caso normal. Quando o
 * login entrar, a rota passa a responder 401 para visitante, e 401 -> `null`
 * continua sendo exatamente a resposta certa.
 *
 * @returns {Promise<{ nickname?: string, gender?: 'm'|'f'|null }|null>}
 */
export async function me() {
  try {
    return await request('/api/v1/users/me');
  } catch {
    return null;
  }
}
