import { normalizeEmail } from './identity.js';

/**
 * OpenID Connect com o Google, a parte pura: montar a URL de autorizacao,
 * abrir o `id_token` e conferir as claims. Nada de rede aqui — a troca do
 * `code` (que e `fetch`) mora em `auth.js`. Folha testavel com um token
 * fabricado.
 *
 * ASSINATURA NAO E VERIFICADA, DE PROPOSITO. O `id_token` chega pelo canal de
 * tras: o proprio servidor faz o POST no endpoint de token do Google, por TLS,
 * e le a resposta. Para esse caso a spec (OIDC Core 3.1.3.7, nota 6) dispensa
 * a checagem de assinatura — a validacao do certificado do Google no TLS ja
 * responde "isto veio do Google". E o que nos poupa de baixar JWKS, cachear
 * chave e trazer uma biblioteca. Se um dia o token vier do CLIENTE (One Tap,
 * botao do Google no browser), ai a assinatura passa a ser obrigatoria, porque
 * o canal deixa de ser confiavel.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** As duas formas que o Google usa em `iss`, conforme a doc. */
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * URL para onde o botao "Entrar com Google" leva. `prompt=select_account`
 * mostra o seletor de conta mesmo com uma so logada — e o que permite testar
 * "conta nao convidada" sem sair do Google.
 */
export function googleAuthUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/**
 * Payload do JWT (a parte do meio, base64url de JSON). Qualquer coisa fora do
 * formato devolve `null` em vez de lancar: o chamador ja esta num fluxo de
 * redirect e trata `null` como "login falhou".
 *
 * @param {string} jwt
 * @returns {object|null}
 */
export function decodeIdToken(jwt) {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * As claims que importam, e so elas. `skewMs` tolera relogio adiantado do
 * servidor; `exp` vem em segundos.
 *
 * @returns {{ ok: true, claims: { sub: string, email: string, name: string, givenName: string, picture: string|null } }
 *         | { ok: false, error: string }}
 */
export function verifyClaims(payload, { clientId, now = Date.now(), skewMs = 60_000 }) {
  if (!payload || typeof payload !== 'object') return fail('token vazio');
  if (!ISSUERS.has(payload.iss)) return fail('iss inesperado');
  if (payload.aud !== clientId) return fail('aud nao e este app');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 + skewMs <= now) {
    return fail('token expirado');
  }
  // Sem isto um e-mail nao confirmado no Google entraria pela allowlist de
  // outra pessoa. E a unica claim de seguranca alem de iss/aud/exp.
  if (payload.email_verified !== true) return fail('e-mail nao verificado no Google');
  if (typeof payload.sub !== 'string' || !payload.sub) return fail('sub ausente');
  if (typeof payload.email !== 'string' || !payload.email) return fail('email ausente');

  return {
    ok: true,
    claims: {
      sub: payload.sub,
      email: normalizeEmail(payload.email),
      name: typeof payload.name === 'string' ? payload.name : '',
      // Primeiro nome: vira a SUGESTAO de apelido no primeiro login (item 4).
      // Nao e persistido — so viaja na URL do redirect.
      givenName: typeof payload.given_name === 'string' ? payload.given_name : '',
      picture: typeof payload.picture === 'string' && payload.picture ? payload.picture : null,
    },
  };
}

const fail = (error) => ({ ok: false, error });
