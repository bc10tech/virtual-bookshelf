/**
 * Unica porta de entrada para os dados. Todo o resto do codigo fala com esta
 * fachada, entao trocar o backend (hoje Express + MongoDB local, amanha uma API
 * autenticada em producao) nao encosta em mais nenhum arquivo.
 */

const BASE = '/api/books';

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

/** @returns {Promise<Array<object>>} livros na ordem da estante */
export const list = () => request(BASE);

export const add = (record) => request(BASE, json(record));

export const update = (id, patch) =>
  request(`${BASE}/${encodeURIComponent(id)}`, {
    ...json(patch),
    method: 'PATCH',
  });

export const remove = (id) =>
  request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
