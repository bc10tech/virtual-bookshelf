import {
  MAX,
  PAGES,
  RATING,
  COVER_HOST_RE,
  DATE_RE,
  ID_RE,
  TIMESTAMP_RE,
} from './limits.js';

/**
 * Validacao de schema no proprio MongoDB: a SEGUNDA barreira, independente do
 * zod de `validate.js`.
 *
 * A primeira barreira valida a ENTRADA da API; esta valida o DOCUMENTO GRAVADO
 * — que tem `_id`, `userId`, `order`, `createdAt` e `updatedAt`, campos que o
 * zod nunca ve porque `books.js` os monta depois. Por isso as duas nao sao
 * geradas uma da outra: elas descrevem coisas diferentes. O que compartilham,
 * compartilham por `limits.js`, e la esta escrito o invariante de direcao que
 * mantem esta barreira defendendo em vez de derrubando.
 *
 * Nao e aplicada no boot do app, de proposito: `collMod` exige `dbAdmin`, e o
 * usuario que a aplicacao usa e `readWrite` escopado ao banco. Quem aplica e
 * `scripts/db.mjs setup`, com a credencial de operacao.
 *
 * Dado puro — nenhum import do driver, para o script poder ler isto sem subir
 * meio servidor.
 */

/**
 * `$jsonSchema` nao e JSON Schema completo. Tres armadilhas que ja custaram
 * tempo e valem a nota:
 *   - `type: "integer"` nao existe; e `bsonType: 'int'`.
 *   - `type` e `bsonType` nao podem aparecer no mesmo subschema.
 *   - `format` nao e suportado — datas se conferem por `pattern`.
 */
export const BOOK_SCHEMA = {
  bsonType: 'object',

  // Todos os dezesseis. Um POST sempre produz os dezesseis (os opcionais ganham
  // `.default()` no modo de criacao, e `coverSource` e derivado sempre que
  // `coverUrl` existe no valor — que na criacao e sempre), e o PATCH so faz
  // `$set`: nunca remove campo. Entao "obrigatorio" aqui e a verdade sobre tudo
  // que este codigo escreve, nao um desejo.
  required: [
    '_id',
    'userId',
    'title',
    'author',
    'pages',
    'coverUrl',
    'coverSource',
    'olKey',
    'isbn',
    'startDate',
    'endDate',
    'rating',
    'review',
    'order',
    'createdAt',
    'updatedAt',
  ],

  properties: {
    // `_id` PRECISA estar listado. Com `additionalProperties: false` e ele de
    // fora, todo insert falha — e o erro nao diz que o problema e o `_id`.
    _id: { bsonType: 'string', pattern: ID_RE.source },

    // Aceita os dois estados de proposito: hoje e sempre `null` (nao ha login),
    // e no ponto 3 vira o id do dono. Assim o validador nao precisa ser
    // reaplicado no meio da migracao de autenticacao.
    //
    // TODO(ponto 3): quando `owner()` em `books.js` deixar de devolver `null` e
    // o backfill terminar, apertar para `bsonType: 'string'` e rodar
    // `db.mjs setup` de novo. Enquanto a uniao existir, esta barreira NAO pega
    // "esqueci de carimbar o userId" — que e exatamente o bug que a autorizacao
    // do ponto 4 mais teme.
    userId: { bsonType: ['string', 'null'] },

    title: { bsonType: 'string', minLength: 1, maxLength: MAX.title },

    // Nao e nullable: o zod transforma `null` em `''` antes de gravar.
    author: { bsonType: 'string', maxLength: MAX.author },

    pages: { bsonType: ['int', 'null'], minimum: PAGES.min, maximum: PAGES.max },

    // O inverso do `author`: aqui o zod transforma `''` em `null`, entao string
    // vazia nao e um estado valido no banco.
    coverUrl: {
      bsonType: ['string', 'null'],
      maxLength: MAX.coverUrl,
      pattern: COVER_HOST_RE.source,
    },

    // Derivado da `coverUrl`, nunca aceito do cliente. Ganha um terceiro valor
    // quando o proxy de capas do ponto 5 entrar.
    coverSource: { bsonType: 'string', enum: ['openlibrary', 'none'] },

    olKey: { bsonType: ['string', 'null'], maxLength: MAX.reference },
    isbn: { bsonType: ['string', 'null'], maxLength: MAX.reference },

    // So o formato. Que 30 de fevereiro nao existe e coisa que `pattern` nao
    // alcanca — fica com o `isIsoDate` do zod, que e a barreira mais estrita das
    // duas, na direcao certa.
    startDate: { bsonType: 'string', pattern: DATE_RE.source },
    endDate: { bsonType: ['string', 'null'], pattern: DATE_RE.source },

    // `'number'` e alias de int/long/double/decimal, e aqui e obrigatorio: o
    // serializador do BSON grava todo inteiro seguro como int32, entao
    // `rating: 0` (o padrao de todo livro sem nota) chega como INT e
    // `rating: 2.5` como DOUBLE. Declarar `'double'` reprovaria a maioria dos
    // documentos.
    rating: { bsonType: 'number', minimum: RATING.min, maximum: RATING.max, multipleOf: RATING.step },

    review: { bsonType: 'string', maxLength: MAX.review },

    order: { bsonType: 'int', minimum: 0 },

    createdAt: { bsonType: 'string', pattern: TIMESTAMP_RE.source },
    updatedAt: { bsonType: 'string', pattern: TIMESTAMP_RE.source },
  },

  // Seguro porque o documento e fechado por construcao: `books.js` monta as
  // dezesseis chaves explicitamente e o `z.object` faz strip de qualquer outra.
  //
  // O custo e de processo, e vale saber antes de esbarrar nele: dali em diante,
  // campo novo no livro e deploy em DOIS passos — alargar este schema e rodar
  // `db.mjs setup` primeiro, subir o codigo depois. Na ordem inversa, a escrita
  // e rejeitada em producao. A falha e barulhenta, que e o modo certo de falhar.
  additionalProperties: false,
};

/**
 * `strict` valida todo insert e todo update. `moderate` isentaria para sempre
 * os documentos que ja estivessem invalidos no momento em que o validador
 * entrou — um conjunto invisivel, com regra propria, que ninguem consegue
 * enumerar depois (e no M0 nem o log do mongod e acessivel para contar). Uma
 * barreira com excecao silenciosa nao e barreira.
 *
 * O preco de `strict` e que um documento pre-existente invalido fica
 * IMPATCHAVEL: o update valida o documento inteiro depois da mudanca, entao ate
 * um PATCH so da nota falharia. Por isso `db.mjs setup` roda o `check` antes e
 * se recusa a aplicar enquanto houver divergente.
 */
export const VALIDATION = {
  validator: { $jsonSchema: BOOK_SCHEMA },
  validationLevel: 'strict',
  validationAction: 'error',
};

/**
 * Um indice, porque ha exatamente uma consulta.
 *
 * `{ userId: 1, order: 1 }` serve as quatro queries de `books.js`: a listagem
 * paginada (`sort({order: 1})`), a busca do ultimo `order` no POST
 * (`sort({order: -1})` — um indice composto e percorrivel nos dois sentidos), e
 * o `findOne`/`deleteOne` por `_id`, que o indice do `_id` ja cobre.
 *
 * O `steps.md` pedia mais dois. Ficaram de fora, com a consulta que os
 * justificaria escrita ao lado — o dia em que ela aparecer, o indice ja esta
 * pronto e a razao tambem:
 *
 *   { userId: 1, createdAt: -1 }
 *     Justificaria: uma listagem cronologica FEITA NO SERVIDOR. Nao existe: o
 *     `sortRecords()` de `src/data/sort.js` ordena no cliente sobre o acervo
 *     completo, e a paginacao por cursor depende disso. Traze-la para o Mongo e
 *     mudanca de arquitetura, nao um indice. Hoje o indice seria degenerado de
 *     todo jeito: `userId` vale `null` em 100% dos documentos.
 *
 *   { userId: 1, olKey: 1 }
 *     Justificaria: uma checagem de "voce ja tem este livro". Nao existe — e o
 *     `CLAUDE.md` diz o contrario: dois exemplares do mesmo `olKey` sao caso
 *     SUPORTADO, e precisam ser geometricamente identicos. O indice nao seria so
 *     prematuro; anteciparia uma regra que contradiz um invariante escrito.
 *
 * Indice e a coisa mais barata de acrescentar depois (uma linha, `createIndex` e
 * idempotente, e o build e instantaneo em centenas de documentos). Schema e
 * formato de dado e que sao caros. Adiar indice e onde o "sem peso sem
 * justificativa" tem o melhor retorno — ainda mais num M0 de 512 MB
 * compartilhados, onde cada indice a mais e amplificacao de escrita por insert
 * para zero leitura beneficiada.
 */
export const INDEXES = [{ key: { userId: 1, order: 1 } }];

export const COLLECTION = 'books';
