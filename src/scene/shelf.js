import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  Color,
} from 'three';
import { SHELF, KD, caseHeight, shelfFloorY } from '../config.js';
import { caseGroup, invalidate } from './renderer.js';

/**
 * A estante, construida por codigo a partir das medidas em config.js (extraidas
 * do bookshelf.obj original, que nao faz mais parte do projeto).
 *
 * Todas as caixas de um mesmo material vao para um unico BufferGeometry, entao
 * a estante inteira custa 3 draw calls — com 3 ou com 5 prateleiras. O .obj
 * original custaria 78, um por objeto.
 *
 * Nao ha UVs: a estante nao tem textura nenhuma (o .mtl so define Kd/Ks/Ns),
 * entao gravar 2 floats por vertice seria desperdicio puro.
 */

// --------------------------------------------------- construcao de caixas ---

/** Empilha um quad (2 triangulos) definido por origem + dois vetores tangentes. */
function pushQuad(pos, nrm, idx, o, u, v, n) {
  const base = pos.length / 3;

  // Ordem origem -> origem+u -> origem+u+v -> origem+v da winding CCW vista de
  // fora sempre que u x v == n, que e como as faces abaixo foram escolhidas.
  const corners = [
    o,
    [o[0] + u[0], o[1] + u[1], o[2] + u[2]],
    [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]],
    [o[0] + v[0], o[1] + v[1], o[2] + v[2]],
  ];
  for (const c of corners) {
    pos.push(c[0], c[1], c[2]);
    nrm.push(n[0], n[1], n[2]);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Cuboide eixo-alinhado de [x0,y0,z0] a [x1,y1,z1]. 24 vertices, 12 triangulos. */
function pushBox(pos, nrm, idx, [x0, y0, z0], [x1, y1, z1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;

  pushQuad(pos, nrm, idx, [x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0]); // +X
  pushQuad(pos, nrm, idx, [x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0]); // -X
  pushQuad(pos, nrm, idx, [x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0]); // +Y
  pushQuad(pos, nrm, idx, [x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0]); // -Y
  pushQuad(pos, nrm, idx, [x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1]); // +Z
  pushQuad(pos, nrm, idx, [x0, y0, z0], [0, dy, 0], [dx, 0, 0], [0, 0, -1]); // -Z
}

function geometryFromBoxes(boxes) {
  const pos = [];
  const nrm = [];
  const idx = [];
  for (const [min, max] of boxes) pushBox(pos, nrm, idx, min, max);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- material ---

/**
 * Lambert, nao Standard: sem environment map o PBR ficaria visualmente igual
 * custando um fragment shader muito mais pesado e mais permutacoes de shader.
 */
const lambert = (kd) =>
  new MeshLambertMaterial({
    // Sem o terceiro argumento, `setRGB` interpreta no espaco de trabalho do
    // three, que e Linear-sRGB — que e como o .mtl escreveu os Kd.
    color: new Color().setRGB(kd[0], kd[1], kd[2]),
  });

const materials = {
  walnut: lambert(KD.walnut),
  walnutDark: lambert(KD.walnutDark),
  backPanel: lambert(KD.backPanel),
};

// ------------------------------------------------------------------ estante ---

let meshes = [];

/**
 * (Re)constroi a estante com `n` vaos.
 * Em n=3 sai identica ao modelo original: totalH 1.125, shelf_1 em 0.405..0.425,
 * shelf_2 em 0.755..0.775.
 *
 * @param {number} n numero de vaos (>= SHELF.MIN_SHELVES)
 * @returns {number} altura total da estante
 */
export function buildCase(n) {
  const shelves = Math.max(SHELF.MIN_SHELVES, Math.min(SHELF.MAX_SHELVES, n));
  const totalH = caseHeight(shelves);

  disposeCase();

  const walnutBoxes = [
    // laterais
    [[-SHELF.OUTER_X, SHELF.PLINTH_H, SHELF.BACK_OUTER_Z], [SHELF.INNER_MIN_X, totalH, SHELF.FRONT_Z]],
    [[SHELF.INNER_MAX_X, SHELF.PLINTH_H, SHELF.BACK_OUTER_Z], [SHELF.OUTER_X, totalH, SHELF.FRONT_Z]],
    // base
    [[SHELF.INNER_MIN_X, SHELF.PLINTH_H, SHELF.BACK_OUTER_Z], [SHELF.INNER_MAX_X, SHELF.FIRST_FLOOR_Y, SHELF.FRONT_Z]],
    // tampo (avanca 14 mm a frente das laterais, como no modelo original)
    [[-SHELF.OUTER_X, totalH - SHELF.BOARD_T, SHELF.BACK_OUTER_Z], [SHELF.OUTER_X, totalH, SHELF.TOP_FRONT_Z]],
  ];

  // Uma tabua por vao acima do primeiro.
  for (let k = 1; k < shelves; k++) {
    const y = shelfFloorY(k);
    walnutBoxes.push([
      [SHELF.INNER_MIN_X, y - SHELF.BOARD_T, SHELF.SHELF_BACK_Z],
      [SHELF.INNER_MAX_X, y, SHELF.SHELF_FRONT_Z],
    ]);
  }

  const parts = [
    [geometryFromBoxes(walnutBoxes), materials.walnut],
    [
      geometryFromBoxes([
        [[-SHELF.PLINTH_X, 0, -SHELF.PLINTH_Z], [SHELF.PLINTH_X, SHELF.PLINTH_H, SHELF.PLINTH_Z]],
      ]),
      materials.walnutDark,
    ],
    [
      geometryFromBoxes([
        [
          [SHELF.INNER_MIN_X, SHELF.FIRST_FLOOR_Y, SHELF.BACK_OUTER_Z],
          [SHELF.INNER_MAX_X, totalH - SHELF.BOARD_T, SHELF.BACK_Z],
        ],
      ]),
      materials.backPanel,
    ],
  ];

  meshes = parts.map(([geo, mat]) => {
    const m = new Mesh(geo, mat);
    m.matrixAutoUpdate = false; // a estante nunca se move: uma matriz a menos por frame
    m.updateMatrix();
    caseGroup.add(m);
    return m;
  });

  invalidate();
  return totalH;
}

/** Descarta as geometrias da estante atual (os materiais sao compartilhados). */
export function disposeCase() {
  for (const m of meshes) {
    caseGroup.remove(m);
    m.geometry.dispose();
  }
  meshes = [];
}

export const caseMeshes = () => meshes;
