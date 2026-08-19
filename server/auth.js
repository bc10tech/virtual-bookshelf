import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookies } from './cookies.js';
import {
  REDIRECT_URI,
  SECURE_COOKIES,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  oauthConfigured,
} from './env.js';
import { googleAuthUrl, decodeIdToken, verifyClaims, TOKEN_ENDPOINT } from './oidc.js';
import { resolveLogin } from './users.js';
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  sessionToken,
} from './session.js';

/**
 * Login com Google — Authorization Code com redirect, inteiro no servidor.
 * `GET /auth/google` monta a URL e redireciona; o Google volta em
 * `GET /auth/google/callback?code&state`; o servidor troca o `code` pelo
 * `id_token`, verifica, cria a sessao e redireciona para `/`. Nenhum script do
 * Google no cliente — o botao e um link — e por isso funciona em qualquer
 * browser de celular sem popup bloqueado.
 *
 * TODA saida do callback e um redirect para `/` com `?auth=<motivo>` quando
 * algo falha (a tela de entrada mostra o aviso). Nunca JSON: e uma navegacao,
 * e um 500 em JSON deixaria a pessoa olhando para `{"error":...}`.
 */
export const router = Router();

// Resposta por pessoa e por instante: nada aqui pode ser cacheado.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * O `state` anti-CSRF vive num cookie curto, so no caminho de `/auth`, e e
 * comparado na volta. `SameSite=Lax` aqui e OBRIGATORIO, nao escolha: a volta
 * do Google e uma navegacao cross-site, e com `Strict` o cookie nao viria — todo
 * login falharia com "state nao confere".
 */
const STATE_COOKIE = 'vb.oauth';
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_OPTS = { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, path: '/auth' };

const back = (res, reason, extra = '') => res.redirect(`/?auth=${reason}${extra}`);

/** `req.query.x` do Express 5 pode ser array em chave repetida: so string serve. */
const str = (v) => (typeof v === 'string' ? v : null);

const sameToken = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

router.get('/google', (_req, res) => {
  if (!oauthConfigured()) {
    console.error('[auth] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET nao configurados no .env');
    return back(res, 'erro');
  }
  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { ...STATE_OPTS, maxAge: STATE_TTL_MS });
  res.redirect(googleAuthUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri: REDIRECT_URI, state }));
});

/**
 * Troca o `code` pelo `id_token` no endpoint do Google. E daqui — canal de tras,
 * por TLS — que vem a confianca no token sem verificar assinatura (ver
 * `oidc.js`). `redirect_uri` precisa ser IGUAL ao da URL de autorizacao, e por
 * isso os dois leem `REDIRECT_URI` de `env.js`.
 */
async function exchangeCode(code) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id_token) {
    throw new Error(`token endpoint ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.id_token;
}

router.get('/google/callback', async (req, res) => {
  // Sempre, e primeiro: o state e de uso unico. Mesmo `path` do `set`.
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, STATE_OPTS);

  try {
    const error = str(req.query.error);
    if (error) {
      // `access_denied` e a pessoa fechando a tela do Google. O resto e problema.
      if (error !== 'access_denied') console.error(`[auth] google devolveu error=${error}`);
      return back(res, error === 'access_denied' ? 'cancelado' : 'erro');
    }

    const code = str(req.query.code);
    const state = str(req.query.state);
    if (!code || !state || !sameToken(state, expected)) {
      console.error('[auth] callback sem code, ou state nao confere');
      return back(res, 'erro');
    }

    const idToken = await exchangeCode(code);
    const verified = verifyClaims(decodeIdToken(idToken), { clientId: GOOGLE_CLIENT_ID });
    if (!verified.ok) {
      console.error(`[auth] id_token recusado: ${verified.error}`);
      return back(res, 'erro');
    }

    const outcome = await resolveLogin(verified.claims);
    if (outcome.status === 'not-invited') {
      console.log(`[auth] recusado (nao convidado): ${outcome.email}`);
      return back(res, 'nao-convidado', `&email=${encodeURIComponent(outcome.email)}`);
    }

    const token = await createSession(outcome.user._id);
    setSessionCookie(res, token);
    // Este log e de onde se copia o `sub` para o `db.mjs claim --user`.
    console.log(
      `[auth] login ${outcome.user.email} sub=${outcome.user._id} ` +
        `(${outcome.created ? 'novo' : 'existente'}, ${outcome.user.role})`,
    );
    res.redirect('/');
  } catch (err) {
    console.error('[auth] callback falhou:', err);
    back(res, 'erro');
  }
});

/**
 * POST /auth/logout — apaga a sessao e o cookie. So POST (um GET num link
 * externo derrubaria a sessao de quem clicasse); `SameSite=Lax` cuida do resto.
 */
router.post('/logout', async (req, res) => {
  const token = sessionToken(req);
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.status(204).end();
});
