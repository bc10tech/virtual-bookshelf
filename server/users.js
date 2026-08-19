import { Router } from 'express';
import { users, invites } from './db.js';
import { ADMIN_EMAIL } from './env.js';
import { handleFromEmail, handleWithSuffix } from './identity.js';

export const router = Router();

/**
 * O que o cliente ve de um usuario. `_id` (o `sub`) fica dentro: e o que o
 * `claim` do `db.mjs` pede e o que a estante alheia (item 4) vai usar.
 */
export const publicUser = (u) => ({
  _id: u._id,
  email: u.email,
  name: u.name,
  picture: u.picture,
  handle: u.handle,
  role: u.role,
  nickname: u.nickname,
  gender: u.gender,
  createdAt: u.createdAt,
});

/** GET /api/v1/users/me — a splash e o menu de conta leem daqui. */
router.get('/me', (req, res) => res.json(publicUser(req.user)));

/** Codigo de violacao de indice unico. */
const DUPLICATE = 11000;

/**
 * Handle livre a partir da base: `bruno`, depois `bruno-2`, `bruno-3`... A
 * consulta previa evita a maioria das colisoes; a que sobra (dois primeiros
 * logins no mesmo instante) o `insertOne` pega pelo indice unico e o
 * `resolveLogin` tenta de novo.
 */
export async function allocateHandle(base) {
  for (let n = 1; ; n++) {
    const handle = handleWithSuffix(base, n);
    if (!(await users().findOne({ handle }, { projection: { _id: 1 } }))) return handle;
  }
}

/**
 * Do `id_token` verificado ao usuario logado — ou a recusa.
 *
 * Quem ja tem conta entra sempre (o convite foi consumido no primeiro login);
 * quem nao tem precisa estar em `invites` ou ser o `ADMIN_EMAIL`. O admin e
 * reconhecido tambem num usuario que JA existe: se o e-mail de admin mudar no
 * `.env` para alguem que ja entrou como `user`, o proximo login promove — o
 * bootstrap nao depende da ordem.
 *
 * @param {{ sub: string, email: string, name: string, picture: string|null }} claims
 * @returns {Promise<{ status: 'ok', user: object, created: boolean }
 *                 | { status: 'not-invited', email: string }>}
 */
export async function resolveLogin(claims) {
  const now = new Date().toISOString();
  const isAdmin = claims.email === ADMIN_EMAIL;

  const existing = await users().findOne({ _id: claims.sub });
  if (existing) {
    const $set = { email: claims.email, name: claims.name, picture: claims.picture, lastSeenAt: now };
    if (isAdmin && existing.role !== 'admin') $set.role = 'admin';
    const user = await users().findOneAndUpdate(
      { _id: claims.sub },
      { $set },
      { returnDocument: 'after' },
    );
    return { status: 'ok', user, created: false };
  }

  if (!isAdmin) {
    const invited = await invites().findOne({ _id: claims.email }, { projection: { _id: 1 } });
    if (!invited) return { status: 'not-invited', email: claims.email };
  }

  const base = handleFromEmail(claims.email);
  // Duas tentativas cobrem a corrida de handle; um 11000 em `email` (mesmo
  // e-mail com outro `sub`, conta Google recriada) nao se resolve repetindo e
  // sobe para o callback tratar como erro.
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = {
      _id: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      handle: await allocateHandle(base),
      role: isAdmin ? 'admin' : 'user',
      nickname: null,
      gender: null,
      createdAt: now,
      lastSeenAt: now,
    };
    try {
      await users().insertOne(user);
      return { status: 'ok', user, created: true };
    } catch (err) {
      const onHandle = err?.code === DUPLICATE && err?.keyPattern?.handle;
      if (!onHandle || attempt === 1) throw err;
    }
  }
  throw new Error('unreachable');
}
