import { Router } from 'express';
import { users, invites, books } from './db.js';
import { ADMIN_EMAIL } from './env.js';
import { handleFromEmail, handleWithSuffix } from './identity.js';
import { validateProfile } from './validate.js';
import { MAX, HANDLE_RE } from './limits.js';
import { parsePageQuery, fetchPage } from './books.js';
import { shelfStats } from './stats.js';

export const router = Router();

const bad = (res, error, code = 400) => res.status(code).json({ error });

/**
 * O que o proprio usuario ve de si (`GET /me`, resposta do `PATCH /me`). `_id`
 * (o `sub`) fica dentro: e o que o `claim` do `db.mjs` pede. Inclui `email` e
 * `role`, entao NAO serve para a lista de amigos — essa tem projetor proprio.
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

/**
 * O que os AMIGOS veem de alguem: o minimo para a lista e para o selo da
 * estante. Sem `email`, sem `role`, sem `_id` — a estante alheia e enderecada
 * pelo `handle`, e o `userId` e resolvido aqui dentro.
 */
const friendUser = (u) => ({
  handle: u.handle,
  name: u.name,
  picture: u.picture,
  nickname: u.nickname,
});

/** GET /api/v1/users/me — a splash e o menu de conta leem daqui. */
router.get('/me', (req, res) => res.json(publicUser(req.user)));

/** Codigo de violacao de indice unico. */
const DUPLICATE = 11000;

/** `DocumentValidationFailure` — a segunda barreira (`$jsonSchema`) recusou a escrita. */
const DOC_VALIDATION = 121;

/**
 * PATCH /api/v1/users/me — apelido, genero, handle. O `$set` e EXATAMENTE o
 * que o zod devolveu: `users` e `additionalProperties: false`, entao um
 * `updatedAt` de brinde seria recusado pelo banco (121). A resposta e o
 * usuario inteiro, no formato de `GET /me`, para o cliente substituir o seu.
 */
router.patch('/me', async (req, res) => {
  const parsed = validateProfile(req.body);
  if (!parsed.ok) return bad(res, parsed.error);

  try {
    const user = await users().findOneAndUpdate(
      { _id: req.user._id },
      { $set: parsed.value },
      { returnDocument: 'after' },
    );
    if (!user) return bad(res, 'faca login para continuar', 401);
    res.json(publicUser(user));
  } catch (err) {
    // So `handle` tem indice unico entre os campos editaveis; o `keyPattern`
    // confirma. A mensagem e texto do formulario.
    if (err?.code === DUPLICATE) return bad(res, 'este handle ja esta em uso', 409);
    if (err?.code === DOC_VALIDATION) {
      console.error('[api] PATCH /users/me: documento reprovado pelo validador do banco');
      console.error(JSON.stringify(err.errInfo ?? null, null, 2));
      return bad(res, 'documento reprovado pela validacao do banco', 422);
    }
    throw err;
  }
});

/**
 * GET /api/v1/users — todo mundo que esta logado se ve (a allowlist E o
 * convite; nao ha pedido de amizade). Cada pessoa vem com o resumo da estante:
 * total, terminados no ano, e o que esta lendo agora. O ano vai junto para o
 * cliente escrever "N lidos em {year}" sem discordar do servidor na virada.
 */
router.get('/', async (_req, res) => {
  const year = new Date().getFullYear();
  const [people, rows] = await Promise.all([
    users().find({}).sort({ createdAt: 1 }).toArray(),
    books()
      .find({}, { projection: { _id: 0, userId: 1, title: 1, startDate: 1, endDate: 1, order: 1 } })
      .toArray(),
  ]);
  const stats = shelfStats(rows, year);
  const empty = { total: 0, readThisYear: 0, reading: null };
  res.json({
    year,
    items: people.map((u) => ({ ...friendUser(u), ...(stats.get(u._id) ?? empty) })),
  });
});

/**
 * GET /api/v1/users/:handle/books — a estante de outra pessoa, SOMENTE
 * LEITURA. E a unica leitura do app em que o dono nao e quem esta logado: o
 * `userId` e resolvido aqui a partir do handle, nunca vem do cliente, e a
 * listagem e a mesma de `GET /books` (`fetchPage`). Escrita continua so em
 * `/books`, sempre com `userId: req.user._id`.
 */
router.get('/:handle/books', async (req, res) => {
  const { handle } = req.params;
  // Lixo no handle nem chega ao banco.
  if (typeof handle !== 'string' || handle.length > MAX.handle || !HANDLE_RE.test(handle)) {
    return bad(res, 'estante nao encontrada', 404);
  }
  const q = parsePageQuery(req.query);
  if (!q.ok) return bad(res, q.error);

  const found = await users().findOne({ handle }, { projection: { _id: 1 } });
  if (!found) return bad(res, 'estante nao encontrada', 404);
  res.json(await fetchPage(found._id, q.value));
});

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
