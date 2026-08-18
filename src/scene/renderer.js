import {
  Scene,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  Group,
} from 'three';
import { CAM, LIGHT, UI } from '../config.js';
import { stepTweens, tweenCount, setWaker } from './tween.js';

export const scene = new Scene();
export const caseGroup = new Group(); // a estrutura da estante
export const booksGroup = new Group(); // os livros da estante ativa
scene.add(caseGroup, booksGroup);

export const camera = new PerspectiveCamera(CAM.FOV, 1, CAM.NEAR, CAM.FAR);

/** @type {WebGLRenderer} */
export let renderer;

let rafId = 0;
let dirty = true;

/**
 * Renderizacao sob demanda: parado, nao existe nenhum requestAnimationFrame
 * pendente — zero CPU, zero GPU, zero bateria. O loop so se auto-alimenta
 * enquanto ha tween ativo.
 */
function frame(now) {
  rafId = 0;

  if (tweenCount()) {
    stepTweens(now);
    dirty = true;
  }
  if (dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
  // Reconsultado depois do step: um onDone pode ter encadeado outro tween.
  if (tweenCount() && !rafId) rafId = requestAnimationFrame(frame);
}

/** Marca a cena como suja e garante que havera (pelo menos) mais um frame. */
export function invalidate() {
  dirty = true;
  if (!rafId) rafId = requestAnimationFrame(frame);
}

export function initRenderer(canvas) {
  renderer = new WebGLRenderer({
    canvas,
    antialias: true, // arestas de caixa aliasam muito sem isto, e e barato em GPU tile
    alpha: false, // canvas opaco: dispensa mesclar contra a pagina
    stencil: false, // nao usamos: framebuffer menor
    depth: true,
    powerPreference: 'low-power', // cena estatica de ~50 draw calls nao precisa da GPU dedicada
    preserveDrawingBuffer: false,
  });

  setPixelRatioCap();
  scene.background = new Color(LIGHT.BACKGROUND[UI.DEFAULT_THEME]);

  const hemi = new HemisphereLight(LIGHT.HEMI_SKY, LIGHT.HEMI_GROUND, LIGHT.HEMI_INTENSITY);
  const dir = new DirectionalLight(LIGHT.DIR_COLOR, LIGHT.DIR_INTENSITY);
  dir.position.set(...LIGHT.DIR_POS);
  // Sem shadow map de proposito: e o maior custo de GPU mobile que da para
  // evitar, e a estante e iluminada de forma difusa o suficiente para nao sentir.
  scene.add(hemi, dir);

  setWaker(invalidate);

  // O Safari mobile derruba o contexto WebGL ao ir para segundo plano. Sem o
  // preventDefault, o contexto nunca e restaurado e a tela fica preta.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    setPixelRatioCap();
    onContextRestored?.();
    invalidate();
  });

  return renderer;
}

/**
 * Num celular com devicePixelRatio 3, limitar a 1.75 corta ~2.9x o trabalho de
 * fragment shader — a diferenca visual num objeto marrom fosco e imperceptivel.
 */
function setPixelRatioCap() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
}

let onContextRestored = null;
export const setContextRestoreHandler = (fn) => {
  onContextRestored = fn;
};

/** Troca so o fundo da cena. `setHex` ja interpreta o valor como sRGB. */
export function setSceneBackground(theme) {
  scene.background.setHex(LIGHT.BACKGROUND[theme] ?? LIGHT.BACKGROUND[UI.DEFAULT_THEME]);
  invalidate();
}

export function resizeRenderer(w, h) {
  // `false` porque o CSS e dono do layout do canvas (width/height 100%).
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  invalidate();
}

/** Aparelhos antigos ou com WebGL desabilitado caem na lista HTML simples. */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
