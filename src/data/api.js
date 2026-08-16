/**
 * Unica porta de entrada para os dados. Todo o resto do codigo fala com esta
 * fachada, entao trocar o backend (hoje Express + MongoDB local, amanha uma API
 * autenticada em producao) nao encosta em mais nenhum arquivo.
 */

const BASE = '/api/v1/books';

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Sem conexao com o servidor.');
  }

  if (res.status === 204) return null;

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Erro ${res.status}`);
  return body;
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Acervo inteiro, na ordem da estante.
 *
 * A rota e paginada por cursor, mas a paginacao morre aqui: o empacotamento por
 * largura e a ordenacao dependem da lista completa, entao quem chama continua
 * recebendo um array so. O ganho e ter teto no tamanho de cada resposta — o
 * dia em que valer a pena desenhar antes de tudo chegar, e este laco que muda.
 *
 * `limit` nao vai na URL de proposito: o tamanho de pagina e decisao do
 * servidor, e mora num lugar so.
 *
 * @returns {Promise<Array<object>>} livros na ordem da estante
 */
export async function list() {
  const all = [];
  let cursor = null;

  do {
    const url = cursor === null ? BASE : `${BASE}?cursor=${encodeURIComponent(cursor)}`;
    const page = await request(url);
    if (!page?.items?.length) break; // guarda contra laco infinito
    all.push(...page.items);
    cursor = page.nextCursor ?? null;
  } while (cursor !== null);

  return all;
}

export const add = (record) => request(BASE, json(record));

export const update = (id, patch) =>
  request(`${BASE}/${encodeURIComponent(id)}`, {
    ...json(patch),
    method: 'PATCH',
  });

export const remove = (id) =>
  request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
