import { Router } from 'express';
import { books } from './db.js';
import { validateBook, isValidId } from './validate.js';

export const router = Router();

// O dono e SEMPRE quem esta logado (`requireUser` ja rodou, montado em
// `/api/v1`), e todo filtro de leitura e escrita leva `userId: owner(req)`:
// e a unica regra de autorizacao do app — sem ela, qualquer amigo edita o
// livro de outro sabendo o id.
const owner = (req) => req.user._id;

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
 * `?cursor=&limit=` → `{ ok, value: { cursor, limit } | error }`, na convencao
 * do `validate.js`. So o cursor pode reprovar; `limit` tem padrao.
 */
export function parsePageQuery(query) {
  const limit = parseLimit(query.limit);
  let cursor = null;
  if (query.cursor !== undefined) {
    cursor = Number(query.cursor);
    if (!Number.isInteger(cursor)) return { ok: false, error: 'cursor invalido' };
  }
  return { ok: true, value: { cursor, limit } };
}

/**
 * Uma pagina da estante de `userId`, na ordem de insercao.
 *
 * O cursor e o proprio `order`, que ja e a sequencia canonica no banco e e
 * coberto pelo indice `{ userId: 1, order: 1 }`. Paginar por ESTANTE seria o
 * recorte natural do produto, mas o servidor nao tem como saber onde uma
 * estante termina: o empacotamento e por largura acumulada (`computeLayout`) e
 * a ordenacao e preferencia de visualizacao do cliente. Replicar as duas coisas
 * aqui criaria uma segunda fonte para numeros que so o `config.js` deve ter.
 *
 * Recebe o `userId` em vez de ler `req` porque e a MESMA listagem que serve a
 * estante alheia (`GET /users/:handle/books`, em `users.js`) — a unica leitura
 * do app em que o dono nao e quem esta logado, e o `userId` e resolvido la, no
 * servidor, a partir do handle.
 *
 * @returns {Promise<{ items: object[], nextCursor: number|null }>}
 */
export async function fetchPage(userId, { cursor, limit }) {
  const filter = { userId };
  if (cursor !== null) filter.order = { $gt: cursor };

  // Um a mais que o pedido: o excedente responde "tem proxima pagina?" sem
  // custar uma segunda consulta.
  const rows = await books()
    .find(filter)
    .sort({ order: 1 })
    .limit(limit + 1)
    .toArray();

  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].order : null,
  };
}

/** GET /api/v1/books — uma pagina da MINHA estante. */
router.get('/', async (req, res) => {
  const q = parsePageQuery(req.query);
  if (!q.ok) return bad(res, q.error);
  res.json(await fetchPage(owner(req), q.value));
});

/** POST /api/v1/books — cria um livro no fim da estante. */
router.post('/', async (req, res) => {
  const parsed = validateBook(req.body);
  if (!parsed.ok) return bad(res, parsed.error);

  // `order` e sempre atribuido pelo servidor: aceitar o valor do cliente
  // permitiria colidir ou furar a fila de propositio.
  const last = await books()
    .find({ userId: owner(req) })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const order = last.length ? last[0].order + 1 : 0;

  const now = new Date().toISOString();
  // `userId` DEPOIS do spread: nada que venha do cliente sobrescreve o dono.
  // Hoje o zod ja faz strip de chave desconhecida, mas se um dia `userId`
  // entrar no shape do zod, esta ordem e o que continua segurando.
  const doc = {
    _id: isValidId(req.body?.id) ? req.body.id : crypto.randomUUID(),
    ...parsed.value,
    userId: owner(req),
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
  const current = await books().findOne({ _id: req.params.id, userId: owner(req) });
  if (!current) return bad(res, 'nao encontrado', 404);

  const start = parsed.value.startDate ?? current.startDate;
  const end = 'endDate' in parsed.value ? parsed.value.endDate : current.endDate;
  if (start && end && end < start) {
    return bad(res, 'endDate nao pode ser anterior a startDate');
  }

  let doc;
  try {
    doc = await books().findOneAndUpdate(
      { _id: req.params.id, userId: owner(req) },
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
    userId: owner(req),
  });
  if (!deletedCount) return bad(res, 'nao encontrado', 404);
  res.status(204).end();
});
