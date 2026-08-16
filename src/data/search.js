import { OL, UI } from '../config.js';

/**
 * Busca na Open Library.
 *
 * A chamada sai direto do browser: `openlibrary.org` e `covers.openlibrary.org`
 * respondem `Access-Control-Allow-Origin: *`, entao nao ha nada a ganhar
 * passando por um proxy nosso na fase 1 — so latencia e codigo.
 */

let inFlight = null;
let debounceTimer = 0;

/**
 * URL da capa em tamanho M (~180x280, ~14 KB) — exatamente a resolucao que o
 * atlas usa, entao pedir -L so gastaria banda para depois reduzir.
 *
 * `?default=false` e OBRIGATORIO: sem ele, uma obra sem capa devolve 200 com um
 * placeholder em branco, e o livro apareceria branco sem nenhum erro. Com ele,
 * devolve 404 limpo e o codigo cai na capa procedural.
 */
export const coverUrl = (coverId) =>
  coverId ? `${OL.COVER}${coverId}-M.jpg?default=false` : null;

/**
 * @param {string} term
 * @returns {Promise<Array<{key,title,author,year,coverId,coverUrl,pages,isbn}>>}
 */
export async function searchBooks(term) {
  const q = term.trim();
  if (q.length < UI.SEARCH_MIN_CHARS) return [];

  inFlight?.abort();
  const ac = new AbortController();
  inFlight = ac;

  const url =
    `${OL.SEARCH}?q=${encodeURIComponent(q)}` +
    `&limit=${UI.SEARCH_LIMIT}&fields=${OL.FIELDS}`;

  let data;
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') return null; // superada por uma busca mais nova
    throw new Error('A Open Library nao respondeu. Tente de novo ou cadastre manualmente.');
  } finally {
    if (inFlight === ac) inFlight = null;
  }

  return (data.docs ?? []).map((d) => ({
    key: d.key ?? null,
    title: d.title ?? '',
    author: d.author_name?.[0] ?? '',
    year: d.first_publish_year ?? null,
    coverId: d.cover_i ?? null,
    coverUrl: coverUrl(d.cover_i),
    // Vem na propria resposta da busca, entao a espessura da lombada nao custa
    // nenhuma requisicao extra.
    pages: Number.isFinite(d.number_of_pages_median) ? d.number_of_pages_median : null,
    isbn: d.isbn?.[0] ?? null,
  }));
}

/** Versao com debounce para ligar direto no `input` do campo de busca. */
export function searchDebounced(term, onResult, onError) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const results = await searchBooks(term);
      if (results) onResult(results); // null = requisicao abortada
    } catch (err) {
      onError?.(err);
    }
  }, UI.SEARCH_DEBOUNCE_MS);
}

export const cancelSearch = () => {
  clearTimeout(debounceTimer);
  inFlight?.abort();
  inFlight = null;
};
