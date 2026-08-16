import { z } from 'zod';

/**
 * Validacao de entrada da API.
 *
 * Nasceu escrita a mao e virou zod quando o contrato foi versionado: cada campo
 * novo era uma chance de esquecer um caso, e o formato precisava ficar estavel
 * antes de existir cliente publicado. Como e codigo de servidor, nao pesa um
 * byte no bundle.
 *
 * A superficie exportada e a mesma de antes (`validateBook`, `isValidId`) — o
 * `books.js` nao sabe que a implementacao mudou.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COVER_HOST = 'https://covers.openlibrary.org/';

// As mensagens vao inteiras para o usuario: o cliente lanca `Error(body.error)`
// e o painel mostra esse texto no formulario. Reescrever uma delas muda o que
// alguem le na tela, nao so o log.
const ERR = {
  title: 'title: obrigatorio, ate 300 caracteres',
  author: 'author invalido',
  pages: 'pages: inteiro entre 1 e 5000, ou null',
  cover: 'coverUrl: apenas covers.openlibrary.org',
  start: 'startDate: data ISO yyyy-mm-dd obrigatoria',
  end: 'endDate: data ISO yyyy-mm-dd ou null',
  order: 'endDate nao pode ser anterior a startDate',
  rating: 'rating: de 0 a 5, em passos de 0,5',
  review: 'review: ate 2000 caracteres',
};

/**
 * O regex sozinho aceita 2026-13-45; o `Date.parse` e quem reprova mes e dia
 * fora da faixa. Os dois juntos, porque `Date.parse` tambem aceita formatos que
 * nao queremos ("15 Jan 2026").
 */
const isIsoDate = (d) => DATE_RE.test(d) && !Number.isNaN(Date.parse(d));

/** `olKey` e `isbn` seguem a mesma regra; string vazia vira null. */
const reference = (name) =>
  z
    .string({ error: `${name} invalido` })
    .max(100, { error: `${name} invalido` })
    .nullable()
    .transform((v) => (v ? v.trim() : null));

/**
 * Um validador por campo, definido UMA vez. Os dois modos saem daqui: a
 * criacao acrescenta `.default()`, o PATCH acrescenta `.optional()`. Assim uma
 * regra nova nao tem como entrar em so um dos dois.
 *
 * A ordem das chaves e a ordem em que os erros sao reportados, e a resposta so
 * carrega o primeiro — por isso ela espelha a validacao artesanal anterior.
 */
const FIELDS = {
  title: z
    .string({ error: ERR.title })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0 && s.length <= 300, { error: ERR.title }),

  author: z
    .string({ error: ERR.author })
    .max(300, { error: ERR.author })
    .nullable()
    .transform((v) => (v ?? '').trim()),

  pages: z
    .number({ error: ERR.pages })
    .int({ error: ERR.pages })
    .min(1, { error: ERR.pages })
    .max(5000, { error: ERR.pages })
    .nullable(),

  // Allowlist de host: impede que o documento vire vetor para carregar imagem
  // de qualquer origem no cliente. Quando o proxy de capas entrar (ponto 5 do
  // steps.md), e aqui que a lista afrouxa.
  coverUrl: z
    .string({ error: ERR.cover })
    .max(400, { error: ERR.cover })
    .refine((u) => u === '' || u.startsWith(COVER_HOST), { error: ERR.cover })
    .nullable(),

  olKey: reference('olKey'),
  isbn: reference('isbn'),

  startDate: z.string({ error: ERR.start }).refine(isIsoDate, { error: ERR.start }),

  // Vazio significa "ainda estou lendo" e vira null, igual a ausencia do campo.
  endDate: z
    .string({ error: ERR.end })
    .nullable()
    .refine((d) => d === null || d === '' || isIsoDate(d), { error: ERR.end })
    .transform((v) => v || null),

  rating: z
    .number({ error: ERR.rating })
    .min(0, { error: ERR.rating })
    .max(5, { error: ERR.rating })
    // Meio ponto e permitido (2.5, 3.5...). Notas inteiras ja gravadas
    // continuam validas, entao nao ha migracao a fazer.
    .refine((r) => (r * 2) % 1 === 0, { error: ERR.rating }),

  review: z
    .string({ error: ERR.review })
    .max(2000, { error: ERR.review })
    .nullable()
    .transform((v) => v ?? ''),
};

/** Valores que um POST ganha de graca quando o campo nao vem. */
const DEFAULTS = {
  author: '',
  pages: null,
  coverUrl: null,
  olKey: null,
  isbn: null,
  endDate: null,
  rating: 0,
  review: '',
};

const shape = (mode) =>
  Object.fromEntries(
    Object.entries(FIELDS).map(([key, field]) => [
      key,
      mode === 'create' && key in DEFAULTS
        ? field.default(DEFAULTS[key])
        : mode === 'create'
          ? field // title e startDate: obrigatorios na criacao
          : field.optional(),
    ]),
  );

/**
 * `coverSource` e DERIVADO, nunca aceito do cliente: ele descreve de onde a
 * capa veio, e quem sabe isso e a URL. No PATCH so aparece se `coverUrl` veio
 * junto — senao um patch de nota apagaria a procedencia da capa.
 */
const deriveCoverSource = (value) => {
  if (!('coverUrl' in value)) return value;
  const url = value.coverUrl || null;
  return { ...value, coverUrl: url, coverSource: url ? 'openlibrary' : 'none' };
};

const coherentDates = (value, ctx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', message: ERR.order, path: ['endDate'] });
  }
};

// `z.object` descarta chave desconhecida em vez de reprovar — e isso e
// necessario, nao cosmetico: o cliente manda `id` no corpo do POST e o
// `books.js` le esse campo por fora. Trocar por `.strict()` quebraria o
// cadastro inteiro.
const createSchema = z
  .object(shape('create'))
  .superRefine(coherentDates)
  .transform(deriveCoverSource);

const patchSchema = z
  .object(shape('patch'))
  .superRefine(coherentDates)
  .transform(deriveCoverSource);

/**
 * Normaliza e valida o corpo de um livro.
 * @param {object} body
 * @param {{ partial?: boolean }} opts  partial=true para PATCH
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateBook(body, { partial = false } = {}) {
  // Fica fora do zod de proposito: a mensagem de "isso nem e um objeto" nao
  // deve depender de como a biblioteca nomeia o tipo recebido.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'corpo deve ser um objeto' };
  }

  const result = (partial ? patchSchema : createSchema).safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0].message };
  }

  if (partial && Object.keys(result.data).length === 0) {
    return { ok: false, error: 'nada para atualizar' };
  }

  return { ok: true, value: result.data };
}

/** Ids sao gerados pelo cliente (uuid v4) ou pelo fallback base36. */
export const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
