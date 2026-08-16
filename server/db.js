import { MongoClient } from 'mongodb';

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB || 'virtual_bookshelf';

let client;
let db;

/**
 * Conexao unica reaproveitada por todo o processo. O driver do Mongo ja mantem
 * um pool interno, entao abrir mais de um client so desperdicaria sockets.
 */
export async function connect() {
  if (db) return db;

  client = new MongoClient(URI, {
    // Falha rapido em vez de pendurar a requisicao por 30 s quando o container
    // do Mongo nao esta de pe — que e o erro mais provavel no desenvolvimento.
    serverSelectionTimeoutMS: 3000,
  });
  await client.connect();
  db = client.db(DB_NAME);

  // `userId` ja entra no indice mesmo valendo null em toda a fase 1: quando o
  // login chegar, o indice nao precisa ser recriado.
  await db.collection('books').createIndex({ userId: 1, order: 1 });

  return db;
}

export const books = () => db.collection('books');

export async function close() {
  await client?.close();
  client = undefined;
  db = undefined;
}
