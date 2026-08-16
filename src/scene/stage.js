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
  detachBookMesh,
  dropBookAssets,
  dropAllBookAssets,
} from './book.js';
import { sortRecords, loadSort, saveSort } from '../data/sort.js';
import {
  tween,
  easeOutBack,
  easeInOutCubic,
  easeOutCubic,
  reducedMotion,
} from './tween.js';

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
let sort = loadSort();
let activeCase = 0;
let builtShelves = 0; // quantos vaos a estrutura desenhada tem agora
let selected = null;
let onSelectCb = () => {};
let onCasesChangedCb = () => {};

/** Meshes da estante ativa, por id do registro. */
const meshById = new Map();

/**
 * Ids com mesh sendo montado AGORA — a fila de espera do `meshById`.
 *
 * Sem isto, um `syncScene` que entre enquanto outro espera as capas recalcula
 * `missing` sobre um `meshById` que o primeiro ainda nao preencheu (ele so
 * escreve no callback, conforme cada capa chega). Os dois criam o mesmo livro,
 * o `meshById.set` do segundo sobrescreve a entrada, e o mesh do primeiro fica
 * ORFAO dentro da cena: invisivel para a limpeza da etapa 1, que itera
 * `meshById`, e desenhado exatamente por cima do irmao. Alem do desenho
 * duplicado, excluir esse livro depois chama `dropBookAssets` num material que
 * o orfao continua usando.
 *
 * Havia seis chamadores de `syncScene` e nenhum guarda. A janela era estreita
 * enquanto a capa carregava em ~100 ms; quando `covers.openlibrary.org` ficou
 * inalcancavel, cada `loadImage` passou a gastar os 8 s inteiros do timeout e
 * ela escancarou — qualquer clique durante o carregamento duplicava a estante.
 */
const pendingIds = new Set();

/**
 * O livro ainda pertence a cena AGORA? Precisa ser perguntado depois do
 * download da capa, nao antes: nesse intervalo a estante ativa pode ter mudado,
 * o registro pode ter sido excluido e a ordenacao pode ter movido tudo de
 * lugar. Devolve a colocacao corrente, para o mesh nascer no lugar certo.
 */
function stillWanted(id) {
  const placement = layout.placements.get(id);
  if (placement?.caseIndex !== activeCase) return null;
  return records.some((r) => r._id === id) ? placement : null;
}

const raycaster = new Raycaster();
const ndc = new Vector2();

// --------------------------------------------------------------- reconciliar ---

const shelvesOf = (caseIndex) => layout.shelvesPerCase[caseIndex] ?? SHELF.MIN_SHELVES;

/** Recalcula a colocacao de todos os livros e avisa o paginador. */
function recompute() {
  layout = computeLayout(sortRecords(records, sort));
  activeCase = Math.min(Math.max(0, activeCase), Math.max(0, layout.caseCount - 1));
  onCasesChangedCb(layout.caseCount, activeCase);
}

/** Move um livro para a sua colocacao — de uma vez, ou com um tween curto. */
function placeBook(mesh, placement, animate) {
  mesh.userData.reflow?.cancel();
  mesh.userData.reflow = null;

  const slot = slotPosition(placement);
  const toPos = new Vector3(slot.x, slot.y, slot.z);
  const toScale = new Vector3(placement.thickness, placement.height, placement.depth);

  const still =
    mesh.position.distanceToSquared(toPos) < 1e-8 &&
    mesh.scale.distanceToSquared(toScale) < 1e-8;

  if (!animate || still || reducedMotion()) {
    applyPlacement(mesh, placement);
    return;
  }

  const fromPos = mesh.position.clone();
  const fromScale = mesh.scale.clone();
  mesh.userData.placement = placement;
  mesh.rotation.set(0, 0, 0);

  mesh.userData.reflow = tween({
    dur: ANIM.REFLOW_MS,
    ease: easeInOutCubic,
    onUpdate: (u) => {
      mesh.position.lerpVectors(fromPos, toPos, u);
      mesh.scale.lerpVectors(fromScale, toScale, u);
    },
    onDone: () => {
      mesh.userData.reflow = null;
      applyPlacement(mesh, placement);
    },
  });
}

/**
 * Reconcilia a cena com o layout corrente: descarta o que saiu, cria o que
 * falta e recoloca o resto.
 *
 * Substitui o antigo `rebuild()`, que destruia e recriava tudo. Como edicao,
 * exclusao, ordenacao e crescimento da estante disparam isto o tempo todo,
 * recriar significaria redesenhar dezenas de atlas por clique.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.animate]  anima camera e reposicionamento
 * @param {string}  [opts.exclude]  id que NAO deve ser criado aqui (vai entrar
 *   pela animacao de adicao, e criar aqui o duplicaria)
 */
async function syncScene({ animate = false, exclude = null } = {}) {
  deselect();

  const shelves = shelvesOf(activeCase);
  if (shelves !== builtShelves) {
    builtShelves = shelves;
    frameCase(buildCase(shelves), { animate });
  }

  const wanted = new Map();
  for (const rec of records) {
    const placement = layout.placements.get(rec._id);
    if (placement?.caseIndex === activeCase && rec._id !== exclude) {
      wanted.set(rec._id, { rec, placement });
    }
  }

  // 1) o que saiu da estante ativa some da cena E da memoria de GPU
  for (const [id, mesh] of [...meshById]) {
    if (wanted.has(id)) continue;
    mesh.userData.reflow?.cancel();
    detachBookMesh(mesh);
    dropBookAssets(id);
    meshById.delete(id);
  }

  // 2) o que ficou apenas muda de lugar — nenhum atlas e redesenhado
  for (const [id, { placement }] of wanted) {
    const mesh = meshById.get(id);
    if (mesh) placeBook(mesh, placement, animate);
  }

  // 3) o que falta e criado (aqui sim ha download de capa e desenho de atlas)
  //
  // `pendingIds` tira da conta o que outro syncScene ja esta montando: e o
  // unico ponto em que este metodo le um estado que ele mesmo so vai escrever
  // depois de um `await`.
  const missing = [...wanted.values()].filter(
    ({ rec }) => !meshById.has(rec._id) && !pendingIds.has(rec._id),
  );
  if (missing.length) {
    for (const { rec } of missing) pendingIds.add(rec._id);
    try {
      await createBooksBatched(missing, (mesh, rec) => {
        // O id sair de `pendingIds` por outra mao (editar ou excluir) significa
        // que esta montagem foi invalidada no meio: o mesh nasceu com o dado
        // velho, e quem invalidou ja disparou um syncScene que o refaz.
        const valido = pendingIds.delete(rec._id);

        const placement = valido ? stillWanted(rec._id) : null;
        if (!placement) {
          // O mundo mudou durante o download. Anexar assim mesmo criaria o
          // orfao pelo outro caminho. A geometria e compartilhada e nunca se
          // descarta; o que precisa voltar e o material — mas so se ninguem
          // mais estiver usando.
          if (!meshById.has(rec._id)) dropBookAssets(rec._id);
          return;
        }

        applyPlacement(mesh, placement);
        meshById.set(rec._id, mesh);
        addBook(mesh);
      });
    } finally {
      // Uma capa que estoure deixa o callback sem rodar; sem isto o id ficaria
      // pendente para sempre e o livro nunca mais seria criado.
      for (const { rec } of missing) pendingIds.delete(rec._id);
    }
  }

  invalidate();
}

// ------------------------------------------------------------------- ciclo ---

/** Carrega a estante inteira a partir dos registros ja persistidos. */
export async function initStage(initial) {
  records = [...initial];
  recompute();
  activeCase = Math.max(0, layout.caseCount - 1); // abre na estante mais recente
  onCasesChangedCb(layout.caseCount, activeCase);

  setContextRestoreHandler(() => {
    // O contexto WebGL caiu: meshes e texturas se foram, tudo e recriado.
    meshById.clear();
    // Os meshes em voo morreram junto com o contexto. Deixar os ids pendentes
    // faria o syncScene abaixo pular exatamente os livros que precisa recriar.
    pendingIds.clear();
    dropAllBookAssets();
    builtShelves = 0;
    syncScene().catch((err) => console.error('[stage] falha ao restaurar', err));
  });

  await syncScene();
}

export function setActiveCase(i) {
  if (i === activeCase) return Promise.resolve();
  activeCase = i;
  return syncScene();
}

export const caseCount = () => layout.caseCount;

export const currentSort = () => ({ ...sort });

/** Troca o criterio de ordenacao e reflui a estante inteira. */
export async function setSort(next) {
  sort = { ...next };
  saveSort(sort);
  recompute();
  await syncScene({ animate: true });
}

// ------------------------------------------------------- adicionar um livro ---

/**
 * Insere um livro ja persistido e roda a animacao de confirmacao.
 * @param {object} rec documento devolvido pelo POST
 */
export async function addRecord(rec) {
  records.push(rec);
  recompute();

  const placement = layout.placements.get(rec._id);

  // A estante precisa mudar ANTES do voo, para o livro ter onde pousar. O
  // syncScene tambem cuida do crescimento: como os livros ficam pendurados no
  // topo, ganhar um vao empurra todos eles uma prateleira para cima, e isso
  // acontece enquanto o livro novo ainda esta grande no centro da tela.
  if (placement.caseIndex !== activeCase) {
    activeCase = placement.caseIndex;
    onCasesChangedCb(layout.caseCount, activeCase);
  }

  // O `exclude` protege este livro so do syncScene da linha abaixo. Enquanto a
  // capa dele baixa e a animacao roda, qualquer OUTRO syncScene o veria faltando
  // e o criaria de novo — e o mesh que voa aqui viraria orfao. `pendingIds`
  // cobre a janela inteira, do inicio do voo ate ele pousar.
  pendingIds.add(rec._id);
  try {
    await syncScene({ animate: true, exclude: rec._id });

    const mesh = await createBookMesh(rec, placement);
    meshById.set(rec._id, mesh);
    addBook(mesh);
    await playAddAnimation(mesh, placement);
  } finally {
    pendingIds.delete(rec._id);
  }
  return placement;
}

/** Substitui um registro editado. A capa pode ter mudado, entao o atlas cai. */
export async function updateRecord(rec) {
  const i = records.findIndex((r) => r._id === rec._id);
  if (i >= 0) records[i] = rec;
  else records.push(rec);

  const mesh = meshById.get(rec._id);
  if (mesh) {
    mesh.userData.reflow?.cancel();
    detachBookMesh(mesh);
    meshById.delete(rec._id);
  }
  // Invalida uma montagem em voo: o mesh dela foi desenhado com a capa antiga.
  pendingIds.delete(rec._id);
  dropBookAssets(rec._id);

  recompute();
  await syncScene({ animate: true });
}

export async function removeRecord(id) {
  records = records.filter((r) => r._id !== id);

  const mesh = meshById.get(id);
  if (mesh) {
    mesh.userData.reflow?.cancel();
    detachBookMesh(mesh);
    meshById.delete(id);
  }
  pendingIds.delete(id);
  dropBookAssets(id);

  recompute();
  await syncScene({ animate: true });
}

// ---------------------------------------------------- animacao de adicao ---

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
  if (!p || mesh.userData.reflow) return; // no meio de um reflow, nao briga por posicao
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

function select(mesh, anchor) {
  if (selected === mesh) return;
  if (selected) tweenSelection(selected, false);
  selected = mesh;
  tweenSelection(mesh, true);
  // A ancora e o ponto da tela onde o usuario clicou: o cartao de detalhes
  // nasce junto do livro em vez de num canto fixo.
  onSelectCb(mesh.userData.record, anchor);
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
  if (hit) select(hit.object, { x: clientX, y: clientY });
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
