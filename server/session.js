import { randomBytes } from 'node:crypto';
import { sessions, users } from './db.js';
import { parseCookies } from './cookies.js';
import { SECURE_COOKIES } from './env.js';
import { SESSION_TOKEN_RE } from './limits.js';

/**
 * Sessao em cookie, guardada no Mongo. Sem `express-session`, sem `passport`,
 * sem JWT: um `findOne` por request na chave primaria de `sessions` e nada, e
 * o cookie `httpOnly` significa que um XSS nao rouba a sessao — o que nao seria
 * verdade para um JWT em `localStorage`.
 */

export const SESSION_COOKIE = 'vb.sid';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Validade de uma sessao, renovada a cada uso. */
const TTL_MS = 30 * DAY_MS;
/**
 * Renovar a cada request seria uma escrita por clique. Renova-se so quando a
 * ultima renovacao tem mais de um dia — o que se deduz de `expiresAt`, sem
 * campo novo: `expiresAt - now < TTL - 1 dia`.
 */
const RENEW_AFTER_MS = DAY_MS;

/**
 * As mesmas opcoes no `set` e no `clear`, e a razao e uma pegadinha do browser:
 * `clearCookie` so apaga se `path` (e `domain`) forem IGUAIS aos do cookie
 * gravado. Um objeto so, usado nos dois, nao tem como divergir.
 *
 * `SameSite=Lax`: basta contra CSRF nos POSTs (logout, convites) porque um POST
 * iniciado por outro site nao leva o cookie; e nao atrapalha a volta do Google,
 * que e navegacao top-level (GET) — essa leva.
 */
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: SECURE_COOKIES,
  path: '/',
};

const newToken = () => randomBytes(32).toString('hex');

/** @returns {Promise<string>} o token, para ir no cookie */
export async function createSession(userId) {
  const now = new Date();
  const token = newToken();
  await sessions().insertOne({
    _id: token,
    userId,
    // BSON `Date`, nao string ISO: o indice TTL so enxerga `Date` (ver
    // `SESSION_SCHEMA`).
    createdAt: now,
    expiresAt: new Date(now.getTime() + TTL_MS),
  });
  return token;
}

/**
 * Sessao viva + usuario dono dela, ou `null`. Renova a validade quando vale a
 * pena, e aproveita a mesma passada para o `lastSeenAt` do usuario — sai de
 * graca, uma escrita por dia por sessao.
 *
 * `expiresAt > now` na consulta, alem do TTL: o monitor de expiracao do Mongo
 * roda a cada 60 s, e nesse intervalo o documento vencido ainda existe.
 */
export async function readSession(token) {
  const now = new Date();
  const session = await sessions().findOne({ _id: token, expiresAt: { $gt: now } });
  if (!session) return null;

  const user = await users().findOne({ _id: session.userId });
  if (!user) {
    // Usuario apagado com sessao no ar: a sessao morre junto.
    await sessions().deleteOne({ _id: token });
    return null;
  }

  if (session.expiresAt.getTime() - now.getTime() < TTL_MS - RENEW_AFTER_MS) {
    const expiresAt = new Date(now.getTime() + TTL_MS);
    await Promise.all([
      sessions().updateOne({ _id: token }, { $set: { expiresAt } }),
      users().updateOne({ _id: user._id }, { $set: { lastSeenAt: now.toISOString() } }),
    ]);
  }

  return { session, user };
}

export const destroySession = (token) => sessions().deleteOne({ _id: token });

export const setSessionCookie = (res, token) =>
  res.cookie(SESSION_COOKIE, token, { ...COOKIE_OPTS, maxAge: TTL_MS });

export const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, COOKIE_OPTS);

/** O token do cookie deste request, se tiver o formato certo; senao `null`. */
export const sessionToken = (req) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  // Formato errado nem vai ao banco: e lixo, nao sessao.
  return typeof token === 'string' && SESSION_TOKEN_RE.test(token) ? token : null;
};

/**
 * Middleware das rotas de dado: poe `req.user` e `req.session`, ou responde
 * 401 JSON (a mensagem e conteudo de interface, como as do zod). Um cookie que
 * nao corresponde a sessao viva e apagado de passagem — assim o browser para
 * de mandar lixo a cada request.
 *
 * `Cache-Control: no-store` porque a resposta e por usuario: um cache no meio
 * (ou o "voltar" do browser) nao pode servir a estante de um para outro.
 */
export async function requireUser(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const token = sessionToken(req);
  const found = token ? await readSession(token) : null;
  if (!found) {
    if (SESSION_COOKIE in parseCookies(req.headers.cookie)) clearSessionCookie(res);
    return res.status(401).json({ error: 'faca login para continuar' });
  }
  req.user = found.user;
  req.session = found.session;
  next();
}

/** Depois de `requireUser`. So o admin convida. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'so o administrador pode convidar' });
  }
  next();
}
