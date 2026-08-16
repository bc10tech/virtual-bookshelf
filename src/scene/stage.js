import { Raycaster, Vector2, Vector3, Quaternion } from 'three';
import { ANIM, BOOK, SHELF, UI } from '../config.js';
import { booksGroup, camera, invalidate, setContextRestoreHandler } from './renderer.js';
import { controls, frameCase, pointInFrontOfCamera, visibleSizeAt } from './camera.js';
import { buildCase } from './shelf.js';
import { computeLayout, slotPosition } from './layout.js';
import {
  createBookMesh,
  createBooksBatched,
  addBook,
  applyPlacement,
  clearBooks,
} from './book.js';
import { tween, easeOutBack, easeInOutCubic, easeOutCubic, reducedMotion } from './tween.js';

/**
 * Estado da cena: quais livros existem, em que estante estao e o que aparece
 * na tela agora.
 *
 * Apenas a estante ativa existe na cena. Trocar de estante descarta os meshes e
 * as texturas da anterior, o que limita a memoria de GPU a uma estante por vez,
 * independentemente do tamanho do acervo.
 */

let records = [];
let layout = { placements: new Map(), caseCount: 1, shelvesPerCase: [SHELF.MIN_SHELVES] };
let activeCase = 0;
let selected = null;
let selectTween = null;
let onSelectCb = () => {};
let onCasesChangedCb = () => {};

const raycaster = new Raycaster();
const ndc = new Vector2();

// ------------------------------------------------------------- construcao ---

function shelvesOf(caseIndex) {
  return layout.shelvesPerCase[caseIndex] ?? SHELF.MIN_SHELVES;
}

/**
 * (Re)desenha a estante ativa e todos os livros dela.
 * @param {object} [opts]
 * @param {string} [opts.exclude] id que NAO deve ser criado aqui — usado quando
 *   o livro recem-adicionado vai entrar pela animacao, para nao existir duas vezes.
 */
async function rebuild({ animateCamera = false, exclude = null } = {}) {
  clearBooks();
  deselect();

  const totalH = buildCase(shelvesOf(activeCase));
  frameCase(totalH, { animate: animateCamera });

  const items = records
    .filter(
      (r) => r._id !== exclude && layout.placements.get(r._id)?.caseIndex === activeCase,
    )
    .map((rec) => ({ rec, placement: layout.placements.get(rec._id) }));

  await createBooksBatched(items, (mesh) => addBook(mesh));
}

/**
 * Carrega a estante inteira a partir dos registros ja persistidos.
 * @param {Array<object>} initial
 */
export async function initStage(initial) {
  records = [...initial].sort((a, b) => a.order - b.order);
  layout = computeLayout(records);
  activeCase = Math.max(0, layout.caseCount - 1); // abre na estante mais recente
  onCasesChangedCb(layout.caseCount, activeCase);

  setContextRestoreHandler(() => {
    rebuild().catch((err) => console.error('[stage] falha ao restaurar', err));
  });

  await rebuild();
}

export function setActiveCase(i) {
  if (i === activeCase) return Promise.resolve();
  activeCase = i;
  return rebuild();
}

export const caseCount = () => layout.caseCount;

// ------------------------------------------------------- adicionar um livro ---

/**
 * Insere um livro ja persistido e roda a animacao de confirmacao.
 * @param {object} rec documento devolvido pelo POST
 */
export async function addRecord(rec) {
  records.push(rec);
  records.sort((a, b) => a.order - b.order);

  const prevShelves = shelvesOf(activeCase);
  const prevCases = layout.caseCount;
  layout = computeLayout(records);

  const placement = layout.placements.get(rec._id);

  if (prevCases !== layout.caseCount) onCasesChangedCb(layout.caseCount, activeCase);

  // A estante precisa mudar ANTES do voo, para o livro ter onde pousar.
  if (placement.caseIndex !== activeCase) {
    activeCase = placement.caseIndex;
    onCasesChangedCb(layout.caseCount, activeCase);
    await rebuild({ animateCamera: true, exclude: rec._id });
  } else if (shelvesOf(activeCase) !== prevShelves) {
    // Cresceu uma prateleira: reconstroi a estrutura e reenquadra a camera
    // enquanto o livro ainda esta parado no centro da tela, para a mudanca ler
    // como intencional em vez de corte seco.
    const totalH = buildCase(shelvesOf(activeCase));
    frameCase(totalH, { animate: true });
  }

  const mesh = await createBookMesh(rec, placement);
  addBook(mesh);
  await playAddAnimation(mesh, placement);
  return placement;
}

/**
 * Apresentar (500 ms) -> segurar (500 ms) -> voar (600 ms).
 * Tudo relativo a camera, porque com o OrbitControls ela pode estar em
 * qualquer angulo quando o usuario confirma.
 */
function playAddAnimation(mesh, placement) {
  const base = new Vector3(placement.thickness, placement.height, placement.depth);
  const slot = slotPosition(placement);
  const target = new Vector3(slot.x, slot.y, slot.z);

  const settle = () => {
    applyPlacement(mesh, placement);
    controls.enabled = true;
    invalidate();
  };

  if (reducedMotion()) {
    settle();
    return Promise.resolve();
  }

  // Enquanto o livro voa, girar a camera junto seria desorientador.
  controls.enabled = false;

  const present = pointInFrontOfCamera(ANIM.PRESENT_DIST);
  const { h: visH, w: visW } = visibleSizeAt(ANIM.PRESENT_DIST);
  // Ajusta pela altura OU pela largura: num celular estreito o termo de largura
  // assume e o livro nunca vaza da tela.
  const k = Math.min(
    (ANIM.PRESENT_FILL_H * visH) / placement.height,
    (ANIM.PRESENT_FILL_W * visW) / placement.depth,
  );

  // Orientacao com a CAPA virada para a camera: lookAt poe o +Z local apontando
  // para ela, e girar -90 graus em Y traz o +X (a capa) para esse lugar.
  mesh.position.copy(present);
  mesh.lookAt(camera.position);
  mesh.rotateY(-Math.PI / 2);
  const qStart = mesh.quaternion.clone();
  const qEnd = new Quaternion(); // identidade: lombada para a frente, na prateleira

  // Ponto de controle erguido: a trajetoria vira um arco em vez de um deslize.
  const control = new Vector3().addVectors(present, target).multiplyScalar(0.5);
  control.y += ANIM.ARC_LIFT;

  mesh.scale.copy(base).multiplyScalar(ANIM.START_SCALE * k);
  invalidate();

  return new Promise((resolve) => {
    tween({
      dur: ANIM.PRESENT_MS,
      ease: easeOutBack,
      onUpdate: (u) => {
        const s = ANIM.START_SCALE + (1 - ANIM.START_SCALE) * u;
        mesh.scale.copy(base).multiplyScalar(s * k);
      },
      onDone: () => {
        tween({
          dur: ANIM.FLY_MS,
          delay: ANIM.HOLD_MS,
          ease: easeInOutCubic,
          onUpdate: (u) => {
            // Bezier quadratica present -> control -> target
            const inv = 1 - u;
            mesh.position
              .copy(present)
              .multiplyScalar(inv * inv)
              .addScaledVector(control, 2 * inv * u)
              .addScaledVector(target, u * u);
            mesh.quaternion.slerpQuaternions(qStart, qEnd, u);
            mesh.scale.copy(base).multiplyScalar(k + (1 - k) * u);
          },
          onDone: () => {
            settle();
            resolve();
          },
        });
      },
    });
  });
}

// -------------------------------------------------------------- selecionar ---

export function setOnSelect(fn) {
  onSelectCb = fn;
}
export function setOnCasesChanged(fn) {
  onCasesChangedCb = fn;
}

function tweenSelection(mesh, on) {
  const p = mesh.userData.placement;
  if (!p) return;
  const base = new Vector3(p.thickness, p.height, p.depth);
  const restZ = slotPosition(p).z;
  const fromZ = mesh.position.z;
  const toZ = on ? restZ + BOOK.SELECT_LIFT_Z : restZ;
  const fromS = mesh.scale.x / p.thickness;
  const toS = on ? BOOK.SELECT_SCALE : 1;

  tween({
    dur: ANIM.SELECT_MS,
    ease: easeOutCubic,
    onUpdate: (u) => {
      mesh.position.z = fromZ + (toZ - fromZ) * u;
      mesh.scale.copy(base).multiplyScalar(fromS + (toS - fromS) * u);
    },
  });
}

export function deselect({ silent = false } = {}) {
  if (!selected) return;
  if (booksGroup.children.includes(selected)) tweenSelection(selected, false);
  selected = null;
  if (!silent) onSelectCb(null);
  invalidate();
}

function select(mesh) {
  if (selected === mesh) return;
  if (selected) tweenSelection(selected, false);
  selected = mesh;
  tweenSelection(mesh, true);
  onSelectCb(mesh.userData.record);
  invalidate();
}

/**
 * Clique num livro. Chamado no pointerup e so quando o ponteiro praticamente
 * nao andou — caso contrario todo arrasto de camera terminaria selecionando
 * algum livro.
 */
export function pickAt(clientX, clientY, canvas) {
  if (!controls?.enabled) return;

  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  // Raycast contra ~50 caixas, e so no clique: custo desprezivel.
  const hit = raycaster.intersectObjects(booksGroup.children, false)[0];
  if (hit) select(hit.object);
  else deselect();
}

/** Liga os eventos de ponteiro do canvas. */
export function bindPicking(canvas) {
  let downX = 0;
  let downY = 0;
  let downId = null;

  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downId = e.pointerId;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId !== downId) return;
    downId = null;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved <= UI.CLICK_SLOP_PX) pickAt(e.clientX, e.clientY, canvas);
  });

  canvas.addEventListener('pointercancel', () => {
    downId = null;
  });
}

export const allRecords = () => records;
