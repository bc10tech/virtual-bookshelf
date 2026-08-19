import { Router } from 'express';
import { invites, users } from './db.js';
import { requireAdmin } from './session.js';
import { validateInvite } from './validate.js';
import { normalizeEmail } from './identity.js';

/**
 * A allowlist administravel pelo app — o pedido central do item 3: liberar um
 * e-mail do celular, sem tocar em `.env` nem em console. Montado depois de
 * `requireUser`; aqui so o admin passa.
 */
export const router = Router();
router.use(requireAdmin);

const bad = (res, error, code = 400) => res.status(code).json({ error });
const DUPLICATE = 11000;

const publicInvite = (doc, accepted) => ({
  email: doc._id,
  invitedBy: doc.invitedBy,
  createdAt: doc.createdAt,
  accepted,
});

/** GET / — todos os convites, com "ja entrou?" para a lista dizer quem aceitou. */
router.get('/', async (_req, res) => {
  const docs = await invites().find({}).sort({ createdAt: 1 }).toArray();
  const emails = docs.map((d) => d._id);
  const joined = new Set(
    (await users().find({ email: { $in: emails } }, { projection: { email: 1 } }).toArray()).map(
      (u) => u.email,
    ),
  );
  res.json({ items: docs.map((d) => publicInvite(d, joined.has(d._id))) });
});

/** POST / — `{ email }`. O e-mail chega minusculo do zod; e o `_id`. */
router.post('/', async (req, res) => {
  const parsed = validateInvite(req.body);
  if (!parsed.ok) return bad(res, parsed.error);

  const doc = {
    _id: parsed.value.email,
    invitedBy: req.user._id,
    createdAt: new Date().toISOString(),
  };
  try {
    await invites().insertOne(doc);
  } catch (err) {
    if (err?.code === DUPLICATE) return bad(res, 'ja convidado', 409);
    throw err;
  }
  const accepted = Boolean(await users().findOne({ email: doc._id }, { projection: { _id: 1 } }));
  res.status(201).json(publicInvite(doc, accepted));
});

/**
 * DELETE /:email — revoga. Nao derruba quem ja entrou: `users` continua, e a
 * sessao tambem (para isso, apagar as sessoes do usuario — item 8).
 */
router.delete('/:email', async (req, res) => {
  const { deletedCount } = await invites().deleteOne({ _id: normalizeEmail(req.params.email) });
  if (!deletedCount) return bad(res, 'convite nao encontrado', 404);
  res.status(204).end();
});
