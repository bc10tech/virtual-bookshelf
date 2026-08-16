import { Router } from 'express';
import { books } from './db.js';
import { validateBook, isValidId } from './validate.js';

export const router = Router();

// userId fica fixo em null durante a fase 1 (sem login). Quando a
// autenticacao entrar, isto vira `req.user.id` e todo o resto continua igual.
const owner = () => null;

const bad = (res, error, code = 400) => res.status(code).json({ error });

/** GET /api/books — a estante inteira, na ordem de insercao. */
router.get('/', async (_req, res) => {
  const list = await books()
    .find({ userId: owner() })
    .sort({ order: 1 })
    .toArray();
  res.json(list);
});

/** POST /api/books — cria um livro no fim da estante. */
router.post('/', async (req, res) => {
  const parsed = validateBook(req.body);
  if (!parsed.ok) return bad(res, parsed.error);

  // `order` e sempre atribuido pelo servidor: aceitar o valor do cliente
  // permitiria colidir ou furar a fila de propositio.
  const last = await books()
    .find({ userId: owner() })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const order = last.length ? last[0].order + 1 : 0;

  const now = new Date().toISOString();
  const doc = {
    _id: isValidId(req.body?.id) ? req.body.id : crypto.randomUUID(),
    userId: owner(),
    ...parsed.value,
    order,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await books().insertOne(doc);
  } catch (err) {
    if (err?.code === 11000) return bad(res, 'id ja existe', 409);
    throw err;
  }
  res.status(201).json(doc);
});

/** PATCH /api/books/:id — atualiza campos soltos. */
router.patch('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return bad(res, 'id invalido');

  const parsed = validateBook(req.body, { partial: true });
  if (!parsed.ok) return bad(res, parsed.error);

  // Quando so uma das datas vem no PATCH, a coerencia fim >= inicio precisa
  // ser conferida contra o que ja esta gravado.
  const current = await books().findOne({ _id: req.params.id, userId: owner() });
  if (!current) return bad(res, 'nao encontrado', 404);

  const start = parsed.value.startDate ?? current.startDate;
  const end = 'endDate' in parsed.value ? parsed.value.endDate : current.endDate;
  if (start && end && end < start) {
    return bad(res, 'endDate nao pode ser anterior a startDate');
  }

  const doc = await books().findOneAndUpdate(
    { _id: req.params.id, userId: owner() },
    { $set: { ...parsed.value, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' },
  );
  res.json(doc);
});

/** DELETE /api/books/:id */
router.delete('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return bad(res, 'id invalido');

  const { deletedCount } = await books().deleteOne({
    _id: req.params.id,
    userId: owner(),
  });
  if (!deletedCount) return bad(res, 'nao encontrado', 404);
  res.status(204).end();
});
