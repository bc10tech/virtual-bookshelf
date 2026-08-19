#!/usr/bin/env node
/**
 * Administracao do banco: aplica a segunda barreira e move o acervo.
 *
 *   node --env-file-if-exists=.env scripts/db.mjs check   [--local]
 *   node --env-file-if-exists=.env scripts/db.mjs setup   [--local]
 *   node --env-file-if-exists=.env scripts/db.mjs migrate [--dry-run] [--user <sub>]
 *   node --env-file-if-exists=.env scripts/db.mjs claim   --user <sub> [--local] [--dry-run]
 *
 * Por que um script e nao o boot da aplicacao: aplicar ou trocar o validador e
 * `collMod`, que exige `dbAdmin`. O usuario que a aplicacao usa e `readWrite`
 * escopado ao banco, e deve continuar sendo — entao a operacao administrativa
 * mora aqui, com a credencial de operacao, e roda a mao.
 *
 * As URIs vem SO de variavel de ambiente, nunca de argumento: `argv` aparece no
 * historico do shell e na lista de processos da maquina inteira.
 *
 *   MONGODB_URI        aplicacao, `readWrite`   (o alvo padrao de `check`)
 *   MONGODB_ADMIN_URI  operacao,  `dbAdmin`     (alvo de `setup`, `migrate`, `claim`)
 *   MONGODB_LOCAL_URI  origem da migracao       (default: container local)
 *   MONGODB_DB         nome do banco            (default: virtual_bookshelf)
 *
 * Usa o driver que ja e dependencia do projeto: zero peso novo, e nada disto
 * encosta no bundle do cliente.
 */

import { MongoClient } from 'mongodb';
import { COLLECTIONS, validationFor } from '../server/schema.js';
import { SUB_RE } from '../server/limits.js';

const BOOKS = 'books';
const DB_NAME = process.env.MONGODB_DB || 'virtual_bookshelf';
const LOCAL_URI = process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27017';

const argv = process.argv.slice(2);
const command = argv[0];
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};

/** Nunca imprimir a senha. O host basta para saber com quem se esta falando. */
const redact = (uri) => uri.replace(/\/\/[^@/]*@/, '//***@');

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

const open = async (uri, label) => {
  console.log(`  ${label}: ${redact(uri)}`);
  const client = new MongoClient(uri);
  await client.connect();
  return client;
};

/** Alvo de `check`/`setup`: local quando `--local`, senao a credencial de operacao. */
function target(needsAdmin) {
  if (has('--local')) return LOCAL_URI;
  const uri = needsAdmin ? process.env.MONGODB_ADMIN_URI : process.env.MONGODB_URI;
  const name = needsAdmin ? 'MONGODB_ADMIN_URI' : 'MONGODB_URI';
  if (!uri) die(`${name} nao esta definida. Use --local, ou preencha o .env.`);
  return uri;
}

// ---------------------------------------------------------------------- check

/**
 * `$jsonSchema` tambem e operador de QUERY, e e essa a propriedade que torna a
 * migracao segura: da para listar exatamente o que o validador reprovaria antes
 * de aplica-lo, com privilegio de leitura so, no local e no Atlas igual.
 *
 * (A alternativa obvia — aplicar em `validationAction: 'warn'` e ver o que cai —
 * nao serve num M0: o aviso vai para o log do mongod, e o download desse log e
 * recurso de cluster dedicado. Ali, `warn` e "desliga a barreira e nao conta".)
 */
const findNonConforming = (col, schema) =>
  col.find({ $nor: [{ $jsonSchema: schema }] }).toArray();

/**
 * O `$nor` diz QUAIS documentos reprovam, nao POR QUE. Como o schema e uma
 * conjuncao de campos independentes, da para perguntar campo a campo e atribuir
 * a culpa — que e a diferenca entre "3 divergentes" e "3 divergentes: falta
 * coverSource".
 */
async function explain(col, schema, doc) {
  const reasons = [];

  const extra = Object.keys(doc).filter((k) => !(k in schema.properties));
  if (extra.length) reasons.push(`campo desconhecido: ${extra.join(', ')}`);

  for (const [key, sub] of Object.entries(schema.properties)) {
    if (!(key in doc)) {
      if (schema.required.includes(key)) reasons.push(`${key}: ausente`);
      continue;
    }
    const conforms = await col.countDocuments(
      {
        _id: doc._id,
        $jsonSchema: { bsonType: 'object', required: [key], properties: { [key]: sub } },
      },
      { limit: 1 },
    );
    if (!conforms) reasons.push(`${key}: ${JSON.stringify(doc[key])}`);
  }

  return reasons;
}

/** Relatorio de uma colecao. Devolve quantos documentos o validador reprovaria. */
async function report(col, schema) {
  const total = await col.countDocuments({});
  const bad = await findNonConforming(col, schema);

  console.log(`  documentos: ${total}`);
  if (!bad.length) {
    console.log(`  divergentes: 0  ✓`);
    return 0;
  }

  console.log(`  divergentes: ${bad.length}  ✗\n`);
  for (const doc of bad.slice(0, 20)) {
    console.log(`    ${doc._id}`);
    for (const reason of await explain(col, schema, doc)) console.log(`      · ${reason}`);
  }
  if (bad.length > 20) console.log(`    … e mais ${bad.length - 20}`);
  return bad.length;
}

/** O validador que esta NA colecao hoje (ou `null` se a colecao nao existe). */
async function collectionInfo(db, name) {
  const [info] = await db.listCollections({ name }).toArray();
  return info ?? null;
}

/** Percorre o registro inteiro; devolve a soma dos divergentes. */
async function reportAll(db) {
  let bad = 0;
  for (const [name, { schema }] of Object.entries(COLLECTIONS)) {
    const info = await collectionInfo(db, name);
    const active = Boolean(info?.options?.validator?.$jsonSchema);
    console.log(`\n  [${name}]  validador: ${info ? (active ? 'sim' : 'NAO') : '(colecao nao existe)'}`);
    bad += await report(db.collection(name), schema);
  }
  return bad;
}

async function check() {
  const client = await open(target(false), 'alvo');
  try {
    return await reportAll(client.db(DB_NAME));
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------- setup

async function setup() {
  const client = await open(target(true), 'alvo');
  const db = client.db(DB_NAME);

  try {
    // Pre-check de TODAS antes de aplicar em qualquer uma. Com
    // `validationLevel: 'strict'`, um documento pre-existente invalido ficaria
    // impatchavel — o update valida o documento inteiro depois da mudanca,
    // entao ate um PATCH so da nota reprovaria.
    const bad = await reportAll(db);
    if (bad) {
      die(
        'ha documentos que o validador reprovaria. Conserte-os primeiro:\n' +
          '  aplicar a barreira agora deixaria cada um deles impatchavel.',
      );
    }

    for (const [name, { schema, indexes }] of Object.entries(COLLECTIONS)) {
      console.log(`\n  [${name}]`);
      const validation = validationFor(schema);

      if (await collectionInfo(db, name)) {
        // `collMod` e o unico caminho para uma colecao que ja existe — e o unico
        // que exige `dbAdmin`. Se falhar com Unauthorized, a credencial esta
        // certa para a aplicacao e errada para esta operacao.
        await db.command({ collMod: name, ...validation });
        console.log('  validador: atualizado via collMod');
      } else {
        await db.createCollection(name, validation);
        console.log('  validador: colecao criada com validator');
      }

      // `options` vem do registro junto da chave — ver o comentario de
      // `COLLECTIONS` sobre `IndexOptionsConflict`.
      for (const { key, options } of indexes) {
        const idx = await db.collection(name).createIndex(key, options);
        console.log(`  indice: ${idx}${options ? `  ${JSON.stringify(options)}` : ''}`);
      }

      // Ler de volta, em vez de confiar no retorno do comando.
      const info = await collectionInfo(db, name);
      const applied = Boolean(info?.options?.validator?.$jsonSchema);
      console.log(
        `  validador ativo: ${applied ? 'sim' : 'NAO'}` +
          `  nivel: ${info?.options?.validationLevel ?? '-'}` +
          `  acao: ${info?.options?.validationAction ?? '-'}`,
      );
      if (!applied) die(`o validador nao esta em \`${name}\` depois do comando.`);
    }
  } finally {
    await client.close();
  }
}

// -------------------------------------------------------------------- migrate

async function migrate() {
  const dry = has('--dry-run');
  const userId = valueOf('--user');
  if (has('--user') && !userId) die('--user precisa de um valor.');

  const toUri = target(true);
  if (toUri === LOCAL_URI) die('migrate nao aceita --local: origem e destino seriam o mesmo banco.');

  const from = await open(LOCAL_URI, 'origem');
  const to = await open(toUri, 'destino');

  try {
    const src = from.db(DB_NAME).collection(BOOKS);
    const dst = to.db(DB_NAME).collection(BOOKS);
    const schema = COLLECTIONS[BOOKS].schema;

    // Sem o validador no destino, a migracao perde a unica prova de que os
    // documentos chegaram intactos. `setup` primeiro, sempre.
    const info = await collectionInfo(to.db(DB_NAME), BOOKS);
    if (!info?.options?.validator) {
      die('o destino nao tem o validador aplicado. Rode `db.mjs setup` antes de migrar.');
    }

    const docs = await src.find({}).sort({ order: 1 }).toArray();
    console.log(`\n  a copiar: ${docs.length} documento(s)`);
    if (userId) console.log(`  userId: null -> ${JSON.stringify(userId)}`);

    const bad = await findNonConforming(src, schema);
    if (bad.length) die(`${bad.length} documento(s) na origem reprovariam no destino. Rode \`check --local\`.`);

    if (!docs.length) return console.log('  nada a fazer.');

    if (dry) {
      const jaLa = await dst.countDocuments({ _id: { $in: docs.map((d) => d._id) } });
      console.log(`  destino ja tem ${jaLa} desses ids (seriam substituidos)`);
      console.log(`  destino ao final: ${await dst.countDocuments({})} -> ${docs.length}`);
      return console.log('\n  --dry-run: nada foi escrito.');
    }

    // `replaceOne` com upsert, nao `updateOne` com `$set`: `$set` do `_id`
    // dispararia "would modify the immutable field '_id'". Substituir o
    // documento inteiro tambem e o que torna o script re-executavel sem deixar
    // resto de uma execucao anterior.
    //
    // `ordered: false` para que um documento ruim nao interrompa os outros: o
    // relatorio de erros no fim vale mais que a parada no primeiro.
    const ops = docs.map((doc) => {
      const out = userId ? { ...doc, userId } : doc;
      return { replaceOne: { filter: { _id: doc._id }, replacement: out, upsert: true } };
    });

    let result;
    try {
      result = await dst.bulkWrite(ops, { ordered: false });
    } catch (err) {
      const errors = err?.writeErrors ?? [];
      console.error(`\n  ${errors.length} erro(s) de escrita:`);
      for (const e of errors.slice(0, 10)) {
        const code = e.err?.code ?? e.code;
        console.error(`    ${e.err?.op?._id ?? '?'}  code ${code}${code === 121 ? '  (reprovado pelo validador)' : ''}`);
        if (code === 121) console.error(JSON.stringify(e.err?.errInfo ?? null, null, 2));
      }
      die('migracao incompleta.');
    }

    console.log(`  inseridos: ${result.upsertedCount}  substituidos: ${result.modifiedCount}`);

    // A prova: contagem igual dos dois lados, e o `check` do destino limpo.
    const [srcCount, dstCount] = [await src.countDocuments({}), await dst.countDocuments({})];
    console.log(`\n  origem: ${srcCount}  destino: ${dstCount}  ${srcCount === dstCount ? '✓' : '✗'}`);
    console.log('  conferindo o destino:');
    await report(dst, schema);
  } finally {
    await from.close();
    await to.close();
  }
}

// ---------------------------------------------------------------------- claim

/**
 * Carimba os livros SEM dono (`userId: null`, os da fase sem login) com o
 * `sub` de um usuario. E o passo 2 da migracao do item 3: depois dele o
 * `userId` de `books` pode ser apertado para `string` e o `setup` rodado.
 *
 * Existe separado do `migrate` porque `migrate` e copia entre bancos e recusa
 * `--local` (origem e destino seriam o mesmo); este e uma escrita NO alvo — o
 * container ou o Atlas, um de cada vez.
 */
async function claim() {
  const dry = has('--dry-run');
  const userId = valueOf('--user');
  if (!userId) die('claim exige --user <sub> (o `sub` do Google, que aparece no log de login).');
  if (!SUB_RE.test(userId)) {
    die(`--user ${JSON.stringify(userId)} nao parece um \`sub\` do Google (so digitos). Nao e o e-mail.`);
  }

  const client = await open(target(true), 'alvo');
  const db = client.db(DB_NAME);

  try {
    // O usuario precisa existir NESTE banco: e o que prova que o `sub` e real e
    // que a estante vai para alguem que consegue entrar. Sem isso um typo no
    // sub deixaria os livros com um dono que nunca vai existir.
    const user = await db.collection('users').findOne({ _id: userId });
    if (!user) die(`nao ha usuario ${userId} neste banco. Faca login uma vez apontando para ele primeiro.`);
    console.log(`  usuario: ${user.email} (${user.role})`);

    const books = db.collection(BOOKS);
    const [orphans, mine, others] = await Promise.all([
      books.countDocuments({ userId: null }),
      books.countDocuments({ userId }),
      books.countDocuments({ userId: { $nin: [null, userId] } }),
    ]);
    console.log(`\n  sem dono: ${orphans}   ja de ${userId}: ${mine}   de outros: ${others}`);

    if (!orphans) return console.log('  nada a fazer.');
    if (dry) return console.log('\n  --dry-run: nada foi escrito.');

    const { modifiedCount } = await books.updateMany({ userId: null }, { $set: { userId } });
    console.log(`  carimbados: ${modifiedCount}`);

    console.log('\n  conferindo:');
    await report(books, COLLECTIONS[BOOKS].schema);
  } finally {
    await client.close();
  }
}

// ----------------------------------------------------------------------- main

const COMMANDS = { check, setup, migrate, claim };

if (!COMMANDS[command]) {
  die(
    'uso:\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs check   [--local]\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs setup   [--local]\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs migrate [--dry-run] [--user <sub>]\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs claim   --user <sub> [--local] [--dry-run]',
  );
}

console.log(`\n  ${command}  ·  banco ${DB_NAME}`);
const bad = await COMMANDS[command]();
console.log('');
process.exit(command === 'check' && bad ? 1 : 0);
