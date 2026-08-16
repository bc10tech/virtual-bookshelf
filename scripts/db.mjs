#!/usr/bin/env node
/**
 * Administracao do banco: aplica a segunda barreira e move o acervo.
 *
 *   node --env-file-if-exists=.env scripts/db.mjs check   [--local]
 *   node --env-file-if-exists=.env scripts/db.mjs setup   [--local]
 *   node --env-file-if-exists=.env scripts/db.mjs migrate [--dry-run] [--user <id>]
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
 *   MONGODB_ADMIN_URI  operacao,  `dbAdmin`     (alvo de `setup` e `migrate`)
 *   MONGODB_LOCAL_URI  origem da migracao       (default: container local)
 *   MONGODB_DB         nome do banco            (default: virtual_bookshelf)
 *
 * Usa o driver que ja e dependencia do projeto: zero peso novo, e nada disto
 * encosta no bundle do cliente.
 */

import { MongoClient } from 'mongodb';
import { VALIDATION, INDEXES, COLLECTION } from '../server/schema.js';

const SCHEMA = VALIDATION.validator.$jsonSchema;
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
const findNonConforming = (col) => col.find({ $nor: [{ $jsonSchema: SCHEMA }] }).toArray();

/**
 * O `$nor` diz QUAIS documentos reprovam, nao POR QUE. Como o schema e uma
 * conjuncao de campos independentes, da para perguntar campo a campo e atribuir
 * a culpa — que e a diferenca entre "3 divergentes" e "3 divergentes: falta
 * coverSource".
 */
async function explain(col, doc) {
  const reasons = [];

  const extra = Object.keys(doc).filter((k) => !(k in SCHEMA.properties));
  if (extra.length) reasons.push(`campo desconhecido: ${extra.join(', ')}`);

  for (const [key, sub] of Object.entries(SCHEMA.properties)) {
    if (!(key in doc)) {
      if (SCHEMA.required.includes(key)) reasons.push(`${key}: ausente`);
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

async function report(col) {
  const total = await col.countDocuments({});
  const bad = await findNonConforming(col);

  console.log(`  documentos: ${total}`);
  if (!bad.length) {
    console.log(`  divergentes: 0  ✓`);
    return 0;
  }

  console.log(`  divergentes: ${bad.length}  ✗\n`);
  for (const doc of bad.slice(0, 20)) {
    console.log(`    ${doc._id}`);
    for (const reason of await explain(col, doc)) console.log(`      · ${reason}`);
  }
  if (bad.length > 20) console.log(`    … e mais ${bad.length - 20}`);
  return bad.length;
}

async function check() {
  const client = await open(target(false), 'alvo');
  try {
    return await report(client.db(DB_NAME).collection(COLLECTION));
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------- setup

async function setup() {
  const client = await open(target(true), 'alvo');
  const db = client.db(DB_NAME);

  try {
    // Pre-check ANTES de aplicar. Com `validationLevel: 'strict'`, um documento
    // pre-existente invalido ficaria impatchavel — o update valida o documento
    // inteiro depois da mudanca, entao ate um PATCH so da nota reprovaria.
    const bad = await report(db.collection(COLLECTION));
    if (bad) {
      die(
        'ha documentos que o validador reprovaria. Conserte-os primeiro:\n' +
          '  aplicar a barreira agora deixaria cada um deles impatchavel.',
      );
    }

    const exists = await db.listCollections({ name: COLLECTION }).hasNext();
    if (exists) {
      // `collMod` e o unico caminho para uma colecao que ja existe — e o unico
      // que exige `dbAdmin`. Se falhar com Unauthorized, a credencial esta certa
      // para a aplicacao e errada para esta operacao.
      await db.command({ collMod: COLLECTION, ...VALIDATION });
      console.log('  validador: atualizado via collMod');
    } else {
      await db.createCollection(COLLECTION, VALIDATION);
      console.log('  validador: colecao criada com validator');
    }

    for (const { key } of INDEXES) {
      const name = await db.collection(COLLECTION).createIndex(key);
      console.log(`  indice: ${name}`);
    }

    // Ler de volta, em vez de confiar no retorno do comando.
    const [info] = await db.listCollections({ name: COLLECTION }).toArray();
    const applied = Boolean(info?.options?.validator?.$jsonSchema);
    console.log(
      `\n  validador ativo: ${applied ? 'sim' : 'NAO'}` +
        `  nivel: ${info?.options?.validationLevel ?? '-'}` +
        `  acao: ${info?.options?.validationAction ?? '-'}`,
    );
    if (!applied) die('o validador nao esta na colecao depois do comando.');
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
    const src = from.db(DB_NAME).collection(COLLECTION);
    const dst = to.db(DB_NAME).collection(COLLECTION);

    // Sem o validador no destino, a migracao perde a unica prova de que os
    // documentos chegaram intactos. `setup` primeiro, sempre.
    const [info] = await to.db(DB_NAME).listCollections({ name: COLLECTION }).toArray();
    if (!info?.options?.validator) {
      die('o destino nao tem o validador aplicado. Rode `db.mjs setup` antes de migrar.');
    }

    const docs = await src.find({}).sort({ order: 1 }).toArray();
    console.log(`\n  a copiar: ${docs.length} documento(s)`);
    if (userId) console.log(`  userId: null -> ${JSON.stringify(userId)}`);

    const bad = await findNonConforming(src);
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
    await report(dst);
  } finally {
    await from.close();
    await to.close();
  }
}

// ----------------------------------------------------------------------- main

const COMMANDS = { check, setup, migrate };

if (!COMMANDS[command]) {
  die(
    'uso:\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs check   [--local]\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs setup   [--local]\n' +
      '    node --env-file-if-exists=.env scripts/db.mjs migrate [--dry-run] [--user <id>]',
  );
}

console.log(`\n  ${command}  ·  banco ${DB_NAME}`);
const bad = await COMMANDS[command]();
console.log('');
process.exit(command === 'check' && bad ? 1 : 0);
