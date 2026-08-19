import { MongoClient } from 'mongodb';
import { COLLECTIONS } from './schema.js';

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB || 'virtual_bookshelf';

/**
 * Um predicado, quatro decisoes. O container local e um banco gerenciado
 * respondem de formas diferentes o bastante para que os mesmos numeros nao
 * sirvam aos dois, e espalhar quatro `if (producao)` pelo arquivo seria quatro
 * chances de um deles discordar dos outros.
 *
 * Repara que o host e extraido em vez de procurado na string inteira: uma senha
 * que por acaso contenha "localhost" nao pode decidir isto.
 */
const host = URI.replace(/^mongodb(\+srv)?:\/\//, '')
  .replace(/^[^@/]*@/, '')
  .split(/[/?,]/)[0];
export const isLocal = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);

let client;
let db;

/**
 * Conexao unica reaproveitada por todo o processo. O driver do Mongo ja mantem
 * um pool interno, entao abrir mais de um client so desperdicaria sockets.
 */
export async function connect() {
  if (db) return db;

  client = new MongoClient(
    URI,
    isLocal
      ? {
          // Falha rapido em vez de pendurar a requisicao por 30 s quando o
          // container do Mongo nao esta de pe — que e o erro mais provavel no
          // desenvolvimento.
          serverSelectionTimeoutMS: 3000,
        }
      : {
          // Nada de `serverSelectionTimeoutMS` aqui: o default de 30 s do driver
          // e calibrado justamente para o SRV + TLS a frio de um cluster
          // gerenciado, e 3 s derrubaria o primeiro acesso depois de ocioso.
          //
          // O teto do M0 e 500 conexoes e o default do driver e 100 por
          // processo: uma instancia cabe, mas um punhado de preview deploys
          // somados nao, e o sintoma (falha intermitente de conexao em outro
          // ambiente) e desagradavel de diagnosticar.
          maxPoolSize: 10,
        },
  );
  await client.connect();
  db = client.db(DB_NAME);

  // So no local. Contra um banco gerenciado quem manda em indice e
  // `scripts/db.mjs setup`, com a credencial de operacao — e ele tambem aplica
  // o validador de schema, que `createIndex` nao alcanca porque `collMod` exige
  // `dbAdmin`. Deixar o boot criando indice la teria dois donos para a mesma
  // decisao, e um round trip a mais em todo cold start.
  //
  // As opcoes (`unique`, TTL) vem do registro junto com a chave, de proposito:
  // e o mesmo objeto que o `setup` le, e e o que impede os dois de criarem o
  // mesmo indice com opcoes diferentes (`IndexOptionsConflict`).
  if (isLocal) {
    for (const [name, { indexes }] of Object.entries(COLLECTIONS)) {
      for (const { key, options } of indexes) await db.collection(name).createIndex(key, options);
    }
  }

  return db;
}

/** Ha conexao viva? Usado pelo guarda das rotas de dado e pelo health check. */
export const isConnected = () => Boolean(db);

export const collection = (name) => db.collection(name);
export const books = () => collection('books');
export const users = () => collection('users');
export const sessions = () => collection('sessions');
export const invites = () => collection('invites');

export async function close() {
  await client?.close();
  client = undefined;
  db = undefined;
}
