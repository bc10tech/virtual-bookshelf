import { Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAM, HALF_TAN } from '../config.js';
import { camera, renderer, invalidate, resizeRenderer } from './renderer.js';
import { tween, easeInOutCubic, reducedMotion } from './tween.js';

/** @type {OrbitControls} */
export let controls;

let caseH = 1.125; // altura da estante ativa
let fitDist = 2.04; // distancia que enquadra a estante inteira
let reframeTween = null;

/**
 * Distancia de camera que faz a estante inteira caber, seja pela altura, seja
 * pela largura. Numa tela larga a altura manda; num celular em retrato quem
 * manda e a largura — por isso crescer de 3 para 4 prateleiras no celular
 * costuma nao mudar nada.
 */
function fitDistanceFor(totalH) {
  const aspect = camera.aspect || 1;
  const byHeight = (totalH + CAM.MARGIN_Y) / 2 / HALF_TAN;
  const byWidth = CAM.FRAME_WIDTH / 2 / (HALF_TAN * aspect);
  return Math.max(byHeight, byWidth);
}

/**
 * Direcao unitaria camera -> alvo, e a distancia atual.
 *
 * Normalizar um vetor nulo devolve (0,0,0), e usar isso para reposicionar a
 * camera a coloca EXATAMENTE em cima do alvo — o OrbitControls entao nao
 * consegue derivar um angulo e prende a camera no `minPolarAngle`, dando uma
 * vista de cima inexplicavel. Todo caminho que reposiciona a camera passa por
 * aqui justamente para nao repetir isso.
 */
function orbitOffset() {
  const offset = new Vector3().subVectors(camera.position, controls.target);
  const len = offset.length();
  return len > 1e-6
    ? { dir: offset.divideScalar(len), dist: len }
    : { dir: new Vector3(0, 0, 1), dist: fitDist };
}

export function initControls(canvas) {
  // Uma posicao inicial de frente, para que nenhum caminho de codigo veja a
  // camera colada no alvo antes do primeiro enquadramento.
  camera.position.set(0, 0.5625, fitDistanceFor(1.125));
  camera.lookAt(0, 0.5625, 0);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.5625, 0);

  // Sem damping de proposito: damping exige um requestAnimationFrame permanente
  // e mataria a renderizacao sob demanda. Sem ele, cada movimento do usuario
  // dispara exatamente um frame.
  controls.enableDamping = false;
  controls.enablePan = false; // o alvo e sempre o centro da estante
  controls.minPolarAngle = CAM.MIN_POLAR;
  controls.maxPolarAngle = CAM.MAX_POLAR;
  // Impede girar para tras: o painel de fundo nao tem outro lado.
  controls.minAzimuthAngle = -CAM.AZIMUTH;
  controls.maxAzimuthAngle = CAM.AZIMUTH;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;

  controls.addEventListener('change', invalidate);

  observeResize(canvas);
  return controls;
}

/**
 * Reenquadra para uma estante de altura `totalH`. Chamado quando a estante
 * cresce uma prateleira ou quando o paginador troca de estante.
 */
export function frameCase(totalH, { animate = true } = {}) {
  caseH = totalH;
  fitDist = fitDistanceFor(totalH);

  const targetY = totalH / 2;
  controls.minDistance = fitDist * CAM.MIN_DIST_FACTOR;
  controls.maxDistance = fitDist * CAM.MAX_DIST_FACTOR;

  const fromY = controls.target.y;
  const { dir, dist: fromDist } = orbitOffset();

  const apply = (y, dist) => {
    controls.target.set(0, y, 0);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  };

  if (!animate || reducedMotion()) {
    apply(targetY, fitDist);
    invalidate();
    return;
  }

  reframeTween?.cancel();
  reframeTween = tween({
    dur: CAM.REFRAME_MS,
    ease: easeInOutCubic,
    onUpdate: (u) => apply(fromY + (targetY - fromY) * u, fromDist + (fitDist - fromDist) * u),
    onDone: () => {
      reframeTween = null;
    },
  });
}

/** Ponto no espaco a `dist` metros a frente da camera, no eixo de visao atual. */
export function pointInFrontOfCamera(dist, out = new Vector3()) {
  camera.getWorldDirection(out);
  return out.multiplyScalar(dist).add(camera.position);
}

/** Meia-altura e meia-largura visiveis a `dist` metros da camera. */
export function visibleSizeAt(dist) {
  const h = 2 * dist * HALF_TAN;
  return { h, w: h * (camera.aspect || 1) };
}

// ------------------------------------------------------------------ resize ---

function observeResize(canvas) {
  const parent = canvas.parentElement ?? document.body;
  let pending = 0;

  const ro = new ResizeObserver((entries) => {
    // Coalesce num unico frame: no iOS, mexer na barra de URL dispara varios
    // eventos seguidos, e redimensionar o framebuffer a cada um trava.
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const box = entries[entries.length - 1].contentRect;
      const w = Math.max(1, Math.round(box.width));
      const h = Math.max(1, Math.round(box.height));
      if (!renderer) return;

      resizeRenderer(w, h);

      // Se a nova proporcao exige mais distancia (ex.: girou para retrato), a
      // estante estaria cortada — entao afasta. Se exige menos, respeita o
      // zoom que o usuario escolheu em vez de puxar a camera de volta.
      const needed = fitDistanceFor(caseH);
      fitDist = needed;
      controls.minDistance = needed * CAM.MIN_DIST_FACTOR;
      controls.maxDistance = needed * CAM.MAX_DIST_FACTOR;

      const { dir, dist } = orbitOffset();
      if (dist < needed) {
        camera.position.copy(controls.target).addScaledVector(dir, needed);
        controls.update();
      }
      invalidate();
    });
  });

  ro.observe(parent);
}
