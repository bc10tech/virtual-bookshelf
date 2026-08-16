import { Router } from 'express';
import { books } from './db.js';
import { validateBook, isValidId } from './validate.js';

export const router = Router();

// userId fica fixo em null durante a fase 1 (sem login). Quando a
// autenticacao entrar, isto vira `req.user.id` e todo o resto continua igual.
const owner = () => null;

const bad = (res, error, code = 400) => res.status(code).json({ error });

/** `DocumentValidationFailure` — a segunda barreira (`$jsonSchema`) recusou a escrita. */
const DOC_VALIDATION = 121;

/**
 * Se esta funcao roda, o furo esta na PRIMEIRA barreira: o zod deixou passar
 * algo que o `$jsonSchema` de `schema.js` recusa. Por isso o `errInfo.details`
 * — que no driver 6 diz o keyword exato e o campo que falhou — vai inteiro para
 * o log: e a unica pista de onde as duas divergiram, e sem ela isto seria um
 * 500 opaco. Para o cliente vai so uma frase fixa; a estrutura interna do
 * documento nao e assunto dele.
 */
const schemaRejected = (res, err, where) => {
  console.error(`[api] ${where}: documento reprovado pelo validador do banco`);
  console.error(JSON.stringify(err.errInfo ?? null, null, 2));
  return bad(res, 'documento reprovado pela validacao do banco', 422);
};

// Numeros de servidor, sem relacao com o `config.js` do cliente (que descreve a
// cena). O cliente nao manda `limit`: deixar o padrao aqui mantem o tamanho de
// pagina num lugar so.
const PAGE_LIMIT_DEFAULT = 200;
const PAGE_LIMIT_MAX = 500;

const parseLimit = (raw) => {
  const n = Number(raw);
  // Valor ausente ou absurdo cai no padrao em vez de virar erro: `limit` e
  // ajuste de transporte, nao parte do pedido.
  if (!Number.isInteger(n) || n < 1) return PAGE_LIMIT_DEFAULT;
  return Math.min(n, PAGE_LIMIT_MAX);
};

/**
 * GET /api/v1/books — uma pagina da estante, na ordem de insercao.
 *
 * O cursor e o proprio `order`, que ja e a sequencia canonica no banco e e
 * coberto pelo indice `{ userId: 1, order: 1 }`. Paginar por ESTANTE seria o
 * recorte natural do produto, mas o servidor nao tem como saber onde uma
 * estante termina: o empacotamento e por largura acumulada (`computeLayout`) e
 * a ordenacao e preferencia de visualizacao do cliente. Replicar as duas coisas
 * aqui criaria uma segunda fonte para numeros que so o `config.js` deve ter.
 *
 * @returns {{ items: object[], nextCursor: number|null }}
 */
router.get('/', async (req, res) => {
  const limit = parseLimit(req.query.limit);

  let cursor = null;
  if (req.query.cursor !== undefined) {
    cursor = Number(req.query.cursor);
    if (!Number.isInteger(cursor)) return bad(res, 'cursor invalido');
  }

  const filter = { userId: owner() };
  if (cursor !== null) filter.order = { $gt: cursor };

  // Um a mais que o pedido: o excedente responde "tem proxima pagina?" sem
  // custar uma segunda consulta.
  const rows = await books()
    .find(filter)
    .sort({ order: 1 })
    .limit(limit + 1)
    .toArray();

  const items = rows.slice(0, limit);
  res.json({
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].order : null,
  });
});

/** POST /api/v1/books — cria um livro no fim da estante. */
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
    if (err?.code === DOC_VALIDATION) return schemaRejected(res, err, 'POST');
    throw err;
  }
  res.status(201).json(doc);
});

/** PATCH /api/v1/books/:id — atualiza campos soltos. */
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

  let doc;
  try {
    doc = await books().findOneAndUpdate(
      { _id: req.params.id, userId: owner() },
      { $set: { ...parsed.value, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
  } catch (err) {
    // Com `validationLevel: 'strict'` o update valida o documento INTEIRO depois
    // da mudanca, entao ate um PATCH so da nota reprova se o que ja estava
    // gravado for invalido. E por isso que `db.mjs setup` roda o `check` antes
    // de aplicar o validador.
    if (err?.code === DOC_VALIDATION) return schemaRejected(res, err, `PATCH ${req.params.id}`);
    throw err;
  }
  res.json(doc);
});

/** DELETE /api/v1/books/:id */
router.delete('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return bad(res, 'id invalido');

  const { deletedCount } = await books().deleteOne({
    _id: req.params.id,
    userId: owner(),
  });
  if (!deletedCount) return bad(res, 'nao encontrado', 404);
  res.status(204).end();
});
