import { SHELF, BOOK, bookThickness, shelfFloorY } from '../config.js';

/**
 * Onde cada livro fica na estante.
 *
 * A prateleira enche por LARGURA OCUPADA, nao por contagem: a espessura da
 * lombada vem do numero de paginas, entao um calhamaco de 600 paginas toma o
 * lugar de quase quatro livros finos.
 *
 * O preenchimento comeca pela prateleira DE CIMA e desce. Quando as 5
 * prateleiras enchem, nasce uma estante nova (que o paginador mostra uma de
 * cada vez).
 *
 * Nada disso e persistido: tudo e recalculado a partir da ordem corrente, de
 * `pages` e de um hash deterministico da edicao. Assim o banco fica limpo e um
 * reload reproduz exatamente a mesma estante.
 */

/**
 * Identidade da OBRA, nao do registro.
 *
 * Usar o `_id` aqui era um bug: cada cadastro gera um UUID novo, entao dois
 * exemplares do mesmo livro na mesma estante saiam com alturas diferentes. O
 * `olKey` vem primeiro porque e a chave da obra na Open Library (`/works/OL...`),
 * estavel entre buscas; o `isbn` que a busca devolve e so uma edicao arbitraria
 * entre muitas. Cadastro manual cai no titulo+autor normalizado.
 *
 * (Quando houver login, salgar esta chave com o `userId` faz a mesma obra ter
 * alturas diferentes em estantes de pessoas diferentes, sem mudar mais nada.)
 */
export const editionKey = (rec) =>
  String(rec.olKey || rec.isbn || `${rec.title ?? ''}|${rec.author ?? ''}`)
    .trim()
    .toLowerCase();

/** FNV-1a de 32 bits: barato, deterministico e bem distribuido para chaves curtas. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Numero estavel em [0,1) — nunca Math.random, que mudaria a cada reload. */
const rand01 = (key, salt) => (fnv1a(key + salt) % 100000) / 100000;

/**
 * Proporcao (largura/altura) da capa real de cada EDICAO, anotada pelo
 * `cover.js` quando a imagem chega. Chaveada por `editionKey` pelo mesmo motivo
 * da altura: dois exemplares do mesmo livro tem que sair identicos.
 */
const coverAspect = new Map();

export function rememberCoverAspect(rec, aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  coverAspect.set(editionKey(rec), aspect);
}

/**
 * Dimensoes fisicas de um livro. `pages` manda na espessura; altura vem da
 * edicao (hash) e a profundidade vem da PROPORCAO DA CAPA — assim a capa
 * preenche a face inteira, sem corte nem barra. Sem capa (ou antes de ela
 * chegar), cai na razao fixa.
 *
 * A profundidade so e conhecida depois do download, e isso e seguro porque ela
 * NUNCA entra no empacotamento: `computeLayout` so le `thickness`. Quem cria o
 * mesh rele as dimensoes depois da textura (`refreshDims` no stage.js), e a
 * mudanca nao invalida x, prateleira nem estante de ninguem.
 */
export function bookDimensions(rec) {
  const thickness = bookThickness(rec.pages);
  const height = BOOK.HEIGHT_MIN + BOOK.HEIGHT_RANGE * rand01(editionKey(rec), '#h');
  const aspect = coverAspect.get(editionKey(rec));
  const raw = aspect ? height * aspect : height / BOOK.DEPTH_RATIO;
  const depth = Math.min(BOOK.DEPTH_MAX, Math.max(BOOK.DEPTH_MIN, raw));
  return { thickness, height, depth };
}

/**
 * @typedef {object} Placement
 * @property {number} caseIndex
 * @property {number} shelfIndex   LOGICO: 0 = prateleira de CIMA
 * @property {number} x            centro da lombada
 * @property {number} floorY       altura do piso ja convertida para fisica
 * @property {number} thickness
 * @property {number} height
 * @property {number} depth
 * @property {boolean} reading     em leitura: fica puxado para a frente em repouso
 */

/** "Lendo agora": comecou e ainda nao terminou. O cartao de detalhes usa a mesma regra. */
export const isReading = (rec) => Boolean(rec.startDate && !rec.endDate);

/**
 * @param {Array<object>} records ja na ordem de exibicao desejada
 * @returns {{ placements: Map<string, Placement>, caseCount: number, shelvesPerCase: number[] }}
 */
export function computeLayout(records) {
  const placements = new Map();
  const shelvesPerCase = [];

  let cursor = SHELF.INNER_MIN_X;
  let shelf = 0; // logico: 0 = a de cima
  let caseIndex = 0;

  const noteShelf = () => {
    // Cada estante nasce com 3 vaos (como o modelo original) e so cresce quando
    // precisa, ate o teto de 5.
    shelvesPerCase[caseIndex] = Math.max(
      SHELF.MIN_SHELVES,
      shelvesPerCase[caseIndex] ?? 0,
      shelf + 1,
    );
  };
  noteShelf();

  // --- 1a passada: empacota por largura e descobre quantos vaos cada estante usa
  for (const rec of records) {
    const dims = bookDimensions(rec);

    if (cursor + dims.thickness > SHELF.INNER_MAX_X) {
      shelf++;
      cursor = SHELF.INNER_MIN_X;
      if (shelf >= SHELF.MAX_SHELVES) {
        caseIndex++;
        shelf = 0;
      }
      noteShelf();
    }

    placements.set(rec._id, {
      caseIndex,
      shelfIndex: shelf,
      x: cursor + dims.thickness / 2,
      floorY: 0, // preenchido na 2a passada
      reading: isReading(rec),
      ...dims,
    });

    cursor += dims.thickness + BOOK.GAP;
  }

  // --- 2a passada: converte prateleira logica em fisica
  // So agora sabemos a altura de cada estante, e a prateleira de cima e a
  // ultima fisica. E por isso que crescer um vao empurra TODOS os livros da
  // estante 0.350 m para cima: eles continuam pendurados no topo.
  for (const p of placements.values()) {
    p.floorY = shelfFloorY(shelvesPerCase[p.caseIndex] - 1 - p.shelfIndex);
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
    // irregular do fundo fica escondida. O livro em leitura e a unica excecao,
    // e ela nasce AQUI de proposito: reflow, pouso da adicao e o `restZ` da
    // selecao passam todos por esta funcao, entao nenhum deles precisa saber.
    z: BOOK.FRONT_Z - p.depth / 2 + (p.reading ? BOOK.READING_LIFT_Z : 0),
  };
}
