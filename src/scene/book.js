import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import { COVER } from '../config.js';
import { booksGroup, invalidate } from './renderer.js';
import { buildCoverTexture } from './cover.js';
import { slotPosition } from './layout.js';

/**
 * Todo livro e a MESMA BoxGeometry unitaria, com os UVs ja remapeados para as
 * celulas do atlas — o remapeamento e identico para todos, entao e assado uma
 * vez so. Cada livro difere apenas em `scale` (espessura x altura x
 * profundidade) e na sua textura.
 *
 * Geometria total da estante inteira: 24 vertices.
 *
 * InstancedMesh nao serve aqui: cada livro tem textura propria e o instancing
 * compartilha um unico material. O que da para compartilhar e a geometria.
 */

const S = COVER.SIZE;

/** Retangulo do atlas -> retangulo de UV (com meio pixel de recuo). */
function uvRect(cell) {
  const i = COVER.INSET;
  return {
    u0: (cell.x + i) / S,
    u1: (cell.x + cell.w - i) / S,
    v0: 1 - (cell.y + cell.h - i) / S,
    v1: 1 - (cell.y + i) / S,
  };
}

/** Celula de cor chapada -> um unico ponto: impossivel sangrar entre mipmaps. */
function uvPoint(cell) {
  const u = (cell.x + cell.w / 2) / S;
  const v = 1 - (cell.y + cell.h / 2) / S;
  return { u0: u, u1: u, v0: v, v1: v };
}

/**
 * Faces da BoxGeometry na ordem [+X, -X, +Y, -Y, +Z, -Z].
 * Com a espessura em X, a altura em Y e a profundidade em Z:
 *   +X e -X sao as capas (profundidade x altura)
 *   +Z e a LOMBADA (espessura x altura) — a face que encara a camera na estante
 *   -Z e o corte dianteiro, +Y/-Y sao os cortes de cima e de baixo
 */
const FACE_CELLS = [
  uvRect(COVER.CELL_FRONT), // +X capa
  uvPoint(COVER.CELL_BACK), // -X contracapa
  uvPoint(COVER.CELL_PAGES), // +Y
  uvPoint(COVER.CELL_PAGES), // -Y
  uvRect(COVER.CELL_SPINE), // +Z lombada
  uvPoint(COVER.CELL_PAGES), // -Z
];

function makeBookGeometry() {
  const g = new BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;

  // A BoxGeometry gera 4 vertices por face, com UV padrao (0,1) (1,1) (0,0) (1,0).
  // Basta reescalar cada face para a sua celula.
  for (let f = 0; f < 6; f++) {
    const { u0, u1, v0, v1 } = FACE_CELLS[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
  return g;
}

export const bookGeometry = makeBookGeometry();

// ------------------------------------------------------------------- mesh ---

/**
 * Cria o mesh de um livro ja com a capa carregada.
 * @param {object} rec
 * @param {import('./layout.js').Placement} placement
 * @returns {Promise<Mesh>}
 */
export async function createBookMesh(rec, placement) {
  const map = await buildCoverTexture(rec);
  const mesh = new Mesh(bookGeometry, new MeshLambertMaterial({ map }));
  mesh.userData.record = rec;
  applyPlacement(mesh, placement);
  return mesh;
}

/** Posiciona o livro no seu lugar definitivo na prateleira. */
export function applyPlacement(mesh, placement) {
  const { x, y, z } = slotPosition(placement);
  mesh.position.set(x, y, z);
  mesh.scale.set(placement.thickness, placement.height, placement.depth);
  mesh.rotation.set(0, 0, 0); // +Z (lombada) virado para a camera
  mesh.userData.placement = placement;
}

export function addBook(mesh) {
  booksGroup.add(mesh);
  invalidate();
}

/**
 * A textura e exclusiva de cada livro e precisa ser liberada; a geometria e
 * compartilhada e NUNCA deve ser descartada. Esquecer o `map.dispose()` e o
 * vazamento classico neste tipo de aplicacao.
 */
export function disposeBookMesh(mesh) {
  booksGroup.remove(mesh);
  mesh.material.map?.dispose();
  mesh.material.dispose();
}

export function clearBooks() {
  for (const m of [...booksGroup.children]) disposeBookMesh(m);
  invalidate();
}

/**
 * Cria varios livros com concorrencia limitada: disparar 90 downloads de capa
 * de uma vez satura a fila do browser e a Open Library.
 */
export async function createBooksBatched(items, onMesh, limit = 6) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const { rec, placement } = items[i];
      try {
        onMesh(await createBookMesh(rec, placement), rec);
      } catch (err) {
        console.warn('[book] falha ao montar', rec.title, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
