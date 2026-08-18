import { CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearMipmapLinearFilter } from 'three';
import { WOOD, linearToSrgb } from '../config.js';

/**
 * Textura de madeira procedural para a estante: um ladrilho por tipo (tabuas e
 * painel de fundo), gerados em canvas no boot. Sem download, sem loader, sem
 * licenca de imagem — e a cor media de cada peca continua sendo o Kd do .mtl
 * original, porque os tons sao derivados dele e o veio so modula em torno.
 *
 * O veio corre ao longo de U (x do canvas); os aneis sao transversais (V). O
 * ruido e periodico nos dois eixos, entao o ladrilho repete sem emenda com
 * RepeatWrapping — a geometria da estante mapeia U no eixo LONGO de cada face
 * (shelf.js), o que poe o veio ao longo das tabuas e ao longo da altura das
 * laterais, como madeira serrada de verdade.
 */

/** mulberry32: PRNG semeado, deterministico entre reloads. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Value noise numa grade nu x nv, periodico nos dois eixos (o indice da grade
 * e tomado modulo o tamanho), com valores em [-1, 1].
 */
function periodicNoise(rand, nu, nv) {
  const grid = new Float32Array(nu * nv);
  for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
  return (u, v) => {
    const fu = u * nu;
    const fv = v * nv;
    const i0 = Math.floor(fu);
    const j0 = Math.floor(fv);
    const tu = smooth(fu - i0);
    const tv = smooth(fv - j0);
    const i1 = (i0 + 1) % nu;
    const j1 = (j0 + 1) % nv;
    const iu0 = ((i0 % nu) + nu) % nu;
    const jv0 = ((j0 % nv) + nv) % nv;
    const a = grid[jv0 * nu + iu0];
    const b = grid[jv0 * nu + i1];
    const c = grid[j1 * nu + iu0];
    const d = grid[j1 * nu + i1];
    return (a + (b - a) * tu) * (1 - tv) + (c + (d - c) * tu) * tv;
  };
}

const cache = new Map();

/**
 * @param {'BOARD'|'PANEL'} kind qual bloco de WOOD usar
 * @returns {CanvasTexture} o mesmo objeto para o mesmo `kind` em toda chamada
 */
export function woodTexture(kind = 'BOARD') {
  if (cache.has(kind)) return cache.get(kind);

  const spec = WOOD[kind];
  const px = WOOD.PX;
  // Semente deslocada por tipo: o painel nao repete o desenho das tabuas.
  const rand = prng(WOOD.SEED + Object.keys(WOOD).indexOf(kind) * 1013);
  // Tres oitavas com papeis distintos: a serpentina dos aneis (baixa
  // frequencia, alongada em U), a variacao lenta de tom entre "tabuas", e o
  // veio fino que da a fibra.
  const wobble = periodicNoise(rand, 6, 3);
  const plank = periodicNoise(rand, 2, 5);
  const fiber = periodicNoise(rand, 96, 24);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(px, px);
  const data = image.data;

  const [kr, kg, kb] = spec.KD;
  const C = spec.CONTRAST;

  for (let y = 0; y < px; y++) {
    const v = y / px;
    for (let x = 0; x < px; x++) {
      const u = x / px;

      // Coordenada de anel: V escalado, serpenteando com o ruido lento.
      const ring = v * spec.RINGS + spec.WOBBLE * wobble(u, v);
      const t = ring - Math.floor(ring);
      // Perfil assimetrico: lenho tardio (escuro) estreito, lenho inicial
      // (claro) largo — e o que faz ler como anel e nao como listra.
      const late = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * t), 4);

      const f =
        1 +
        C * (0.35 - 0.9 * late) + // aneis: media levemente acima de 1
        C * 0.28 * plank(u, v) + // tabuas mais claras/escuras
        C * 0.22 * fiber(u, v); // fibra

      const o = (y * px + x) * 4;
      data[o] = Math.round(Math.min(1, linearToSrgb(kr * f)) * 255);
      data[o + 1] = Math.round(Math.min(1, linearToSrgb(kg * f)) * 255);
      data[o + 2] = Math.round(Math.min(1, linearToSrgb(kb * f)) * 255);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  // As tabuas sao vistas de raspao (a camera olha de cima para as prateleiras):
  // sem anisotropia o veio vira um borrao a poucos metros.
  tex.anisotropy = WOOD.ANISOTROPY;
  cache.set(kind, tex);
  return tex;
}
