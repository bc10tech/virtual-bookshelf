/**
 * Ordenacao da estante.
 *
 * E preferencia de VISUALIZACAO, nao dado do livro: fica em localStorage, nunca
 * no MongoDB. O campo `order` do documento continua sendo a ordem de insercao,
 * e serve tanto de criterio "Adicao" quanto de desempate estavel para todos os
 * outros — sem ele, dois livros com a mesma nota trocariam de lugar a cada
 * recalculo.
 */

const STORAGE_KEY = 'vb.sort';

export const DEFAULT_SORT = { by: 'order', dir: 'asc' };

/** Criterios oferecidos, na ordem em que aparecem no menu. */
export const SORTS = [
  { id: 'order', label: 'Adição', asc: 'Mais antigo', desc: 'Mais recente' },
  { id: 'start', label: 'Início da leitura', asc: 'Mais antigo', desc: 'Mais recente' },
  { id: 'end', label: 'Término da leitura', asc: 'Mais antigo', desc: 'Mais recente' },
  { id: 'rating', label: 'Nota', asc: 'Menor', desc: 'Maior' },
  { id: 'title', label: 'Título', asc: 'A–Z', desc: 'Z–A' },
  { id: 'author', label: 'Autor', asc: 'A–Z', desc: 'Z–A' },
  { id: 'pages', label: 'Páginas', asc: 'Mais fino', desc: 'Mais grosso' },
];

/** `sensitivity: 'base'` faz Álvares e Alvares compararem como iguais. */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/**
 * Chave de cada criterio. Devolver `null` significa "sem valor", e esses vao
 * sempre para o fim da estante — nas duas direcoes. Um livro ainda em leitura
 * despencar para o topo so porque a ordenacao foi invertida seria confuso.
 */
const KEYS = {
  order: (r) => r.order,
  start: (r) => r.startDate || null,
  end: (r) => r.endDate || null,
  rating: (r) => (r.rating > 0 ? r.rating : null),
  title: (r) => r.title || null,
  author: (r) => r.author || null,
  pages: (r) => (Number.isFinite(r.pages) ? r.pages : null),
};

const TEXT = new Set(['title', 'author']);

/**
 * @param {Array<object>} records
 * @param {{by: string, dir: 'asc'|'desc'}} sort
 * @returns {Array<object>} uma copia ordenada
 */
export function sortRecords(records, sort = DEFAULT_SORT) {
  const key = KEYS[sort?.by] ?? KEYS.order;
  const sign = sort?.dir === 'desc' ? -1 : 1;
  const isText = TEXT.has(sort?.by);

  return [...records].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const missingA = ka === null || ka === undefined;
    const missingB = kb === null || kb === undefined;

    if (missingA && missingB) return a.order - b.order;
    if (missingA) return 1;
    if (missingB) return -1;

    // Datas em ISO yyyy-mm-dd comparam certo como texto, entao o mesmo ramo
    // serve para numeros e para datas.
    const cmp = isText ? collator.compare(ka, kb) : ka < kb ? -1 : ka > kb ? 1 : 0;
    return cmp !== 0 ? cmp * sign : a.order - b.order;
  });
}

export const sortLabel = (sort) => {
  const s = SORTS.find((o) => o.id === sort?.by) ?? SORTS[0];
  return `${s.label} · ${sort?.dir === 'desc' ? s.desc : s.asc}`;
};

// --------------------------------------------------------------- persistencia ---

export function loadSort() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && KEYS[raw.by]) {
      return { by: raw.by, dir: raw.dir === 'desc' ? 'desc' : 'asc' };
    }
  } catch {
    // localStorage bloqueado (modo privado, cookies desligados): segue no padrao
  }
  return { ...DEFAULT_SORT };
}

export function saveSort(sort) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // preferencia nao persistir nao pode quebrar a ordenacao em si
  }
}
