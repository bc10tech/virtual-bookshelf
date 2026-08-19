/**
 * Unica porta de entrada para os dados. Todo o resto do codigo fala com esta
 * fachada, entao trocar o backend (hoje Express + MongoDB local, amanha uma API
 * autenticada em producao) nao encosta em mais nenhum arquivo.
 */

const BASE = '/api/v1/books';

/**
 * Erro de API com o status junto: `message` continua sendo o texto que o
 * formulario mostra (vem do servidor, em portugues), e `status` e o que deixa
 * o `main.js` distinguir "visitante" (401) de "servidor fora" (0) sem parsear
 * mensagem. Rede fora e `status: 0`.
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError('Sem conexao com o servidor.', 0);
  }

  if (res.status === 204) return null;

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error || `Erro ${res.status}`, res.status);
  return body;
}

export const json = (body, method = 'POST') => ({
  method,
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
  request(`${BASE}/${encodeURIComponent(id)}`, json(patch, 'PATCH'));

export const remove = (id) =>
  request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
