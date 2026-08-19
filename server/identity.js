import { MAX } from './limits.js';

/**
 * Normalizacao de identidade — e-mail e handle. Folha pura: `limits.js` e o
 * unico import, para o `node --test` e o `scripts/db.mjs` alcancarem sem
 * carregar Express nem driver.
 */

/**
 * TODO e-mail passa por aqui antes de ser comparado ou gravado: o `_id` de
 * `invites`, o `ADMIN_EMAIL`, o `email` do `id_token`, o `:email` do DELETE.
 * Um convite gravado como `Ana@Gmail.com` nunca casaria com o `ana@gmail.com`
 * que o Google devolve — e o sintoma seria "convidei e a pessoa nao entra".
 */
export const normalizeEmail = (s) => String(s ?? '').trim().toLowerCase();

/** Ultimo recurso quando a parte local do e-mail nao deixa nada aproveitavel. */
const FALLBACK_HANDLE = 'leitor';

/**
 * Parte local do e-mail em forma de handle: `bcesar97.bc@gmail.com` ->
 * `bcesar97-bc`. Diacriticos caem (NFD e descarte das marcas, `\p{M}`), tudo que
 * nao e `[a-z0-9]` vira um unico hifen, hifens das pontas somem, e o resultado
 * cabe em `MAX.handle` sem terminar em hifen — para casar `HANDLE_RE`.
 *
 * @param {string} email
 * @returns {string}
 */
export function handleFromEmail(email) {
  const local = normalizeEmail(email).split('@')[0] ?? '';
  const ascii = local
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return trimHandle(ascii) || FALLBACK_HANDLE;
}

/**
 * Sufixo de desempate: `n = 1` e o proprio handle; `n = 2` -> `base-2`. A base
 * encolhe para o conjunto caber em `MAX.handle`.
 *
 * @param {string} base
 * @param {number} n
 * @returns {string}
 */
export function handleWithSuffix(base, n) {
  if (n <= 1) return trimHandle(base);
  const suffix = `-${n}`;
  return `${trimHandle(base, MAX.handle - suffix.length)}${suffix}`;
}

/** Corta em `limit` e tira um hifen que tenha sobrado no fim. */
const trimHandle = (s, limit = MAX.handle) => s.slice(0, limit).replace(/-+$/, '');
