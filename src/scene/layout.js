import { SHELF, BOOK, bookThickness, shelfFloorY } from '../config.js';

/**
 * Onde cada livro fica na estante.
 *
 * A prateleira enche por LARGURA OCUPADA, nao por contagem: a espessura da
 * lombada vem do numero de paginas, entao um calhamaco de 600 paginas toma o
 * lugar de quase quatro livros finos. Quando o proximo livro nao cabe, ele vai
 * para a prateleira de cima; quando as 6 prateleiras enchem, nasce uma estante
 * nova (que o paginador mostra uma de cada vez).
 *
 * Nada disso e persistido: tudo e recalculado a partir de `order`, `pages` e de
 * um hash deterministico do id. Assim o banco fica limpo e um reload reproduz
 * exatamente a mesma estante.
 */

/** FNV-1a de 32 bits: barato, deterministico e bem distribuido para ids curtos. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Numero estavel em [0,1) derivado do id — nunca Math.random, que mudaria a cada reload. */
const rand01 = (id, salt) => (fnv1a(id + salt) % 100000) / 100000;

/** Dimensoes fisicas de um livro. `pages` manda na espessura; o resto vem do id. */
export function bookDimensions(rec) {
  const thickness = bookThickness(rec.pages);
  const height = BOOK.HEIGHT_MIN + BOOK.HEIGHT_RANGE * rand01(rec._id, '#h');
  const depth = Math.min(
    BOOK.DEPTH_MAX,
    Math.max(BOOK.DEPTH_MIN, height / BOOK.DEPTH_RATIO),
  );
  return { thickness, height, depth };
}

/**
 * @typedef {object} Placement
 * @property {number} caseIndex
 * @property {number} shelfIndex   0 = prateleira de baixo
 * @property {number} x            centro da lombada
 * @property {number} floorY
 * @property {number} thickness
 * @property {number} height
 * @property {number} depth
 */

/**
 * @param {Array<object>} records ordenados por `order`
 * @returns {{ placements: Map<string, Placement>, caseCount: number, shelvesPerCase: number[] }}
 */
export function computeLayout(records) {
  const placements = new Map();
  const shelvesPerCase = [];

  let cursor = SHELF.INNER_MIN_X;
  let shelfIndex = 0;
  let caseIndex = 0;

  const noteShelf = () => {
    // Cada estante nasce com 3 vaos (como o modelo original) e so cresce quando
    // precisa, ate o teto de 6.
    shelvesPerCase[caseIndex] = Math.max(
      SHELF.MIN_SHELVES,
      shelvesPerCase[caseIndex] ?? SHELF.MIN_SHELVES,
      shelfIndex + 1,
    );
  };
  noteShelf();

  for (const rec of records) {
    const dims = bookDimensions(rec);

    if (cursor + dims.thickness > SHELF.INNER_MAX_X) {
      shelfIndex++;
      cursor = SHELF.INNER_MIN_X;
      if (shelfIndex >= SHELF.MAX_SHELVES) {
        caseIndex++;
        shelfIndex = 0;
      }
      noteShelf();
    }

    placements.set(rec._id, {
      caseIndex,
      shelfIndex,
      x: cursor + dims.thickness / 2,
      floorY: shelfFloorY(shelfIndex),
      ...dims,
    });

    cursor += dims.thickness + BOOK.GAP;
  }

  return {
    placements,
    caseCount: shelvesPerCase.length,
    shelvesPerCase,
  };
}

/** Posicao final do centro do livro na cena, a partir da colocacao. */
export function slotPosition(p) {
  return {
    x: p.x,
    y: p.floorY + p.height / 2,
    // Todas as lombadas alinhadas no mesmo Z: pegam luz por igual e a borda
    // irregular do fundo fica escondida.
    z: BOOK.FRONT_Z - p.depth / 2,
  };
}
