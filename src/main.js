import './styles.css';

import { hasWebGL, initRenderer, resizeRenderer, setSceneBackground } from './scene/renderer.js';
import { initControls } from './scene/camera.js';
import { ensureFonts } from './scene/cover.js';
import {
  initStage,
  addRecord,
  updateRecord,
  removeRecord,
  setActiveCase,
  setSort,
  currentSort,
  setOnSelect,
  setOnCasesChanged,
  bindPicking,
  deselect,
} from './scene/stage.js';
import { createPanel } from './ui/panel.js';
import { createPager } from './ui/pager.js';
import { createDetails } from './ui/details.js';
import { createSortMenu } from './ui/sortMenu.js';
import { createTheme } from './ui/theme.js';
import * as api from './data/api.js';

const $ = (id) => document.getElementById(id);
const live = $('live');

/** Anuncio para leitor de tela; tambem serve de log discreto de estado. */
const announce = (text) => {
  live.textContent = text;
};

function toast(message, kind = 'error') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 7000);
}

function noWebGL() {
  const p = document.createElement('p');
  p.className = 'fallback';
  p.textContent =
    'Seu navegador não conseguiu iniciar o WebGL, então a estante 3D não pode ser desenhada.';
  document.querySelector('.stage').replaceChildren(p);
}

async function boot() {
  const canvas = $('scene');

  if (!hasWebGL()) {
    noWebGL();
    return;
  }

  initRenderer(canvas);
  const stage = canvas.parentElement;
  resizeRenderer(stage.clientWidth || 1, stage.clientHeight || 1);
  initControls(canvas);
  bindPicking(canvas);

  // Carregado antes de qualquer atlas: texto desenhado em canvas com a fonte
  // ainda nao carregada ficaria com o fallback assado na textura para sempre.
  ensureFonts();

  // O tema so mexe no fundo da cena; materiais e luzes ficam iguais.
  createTheme($('theme'), (theme) => setSceneBackground(theme));

  const details = createDetails($('details'));
  details.onClose = () => deselect();

  // A ancora e o ponto da tela onde o usuario clicou: o cartao nasce junto do
  // livro, e se grampeia sozinho para nunca ficar cortado.
  setOnSelect((rec, anchor) => (rec ? details.show(rec, anchor) : details.hide()));

  const pager = createPager($('pager'), (i) => {
    details.hide();
    setActiveCase(i).catch((err) => console.error('[app]', err));
  });
  setOnCasesChanged((count, active) => pager.update(count, active));

  const sortMenu = createSortMenu({
    toggle: $('corner-left'),
    pill: $('sort-by'),
    menu: $('sort-menu'),
    getSort: currentSort,
    onSelect: (next) => {
      details.hide();
      setSort(next).catch((err) => console.error('[app]', err));
    },
  });

  // O retorno do painel e guardado: e por ele que o botao "Editar" do cartao
  // reabre o formulario num registro que ja existe.
  const panel = createPanel({
    // Abrir o formulario limpa a selecao: o cartao de detalhes some junto com o
    // livro levantado, e o menu de ordenacao se recolhe.
    onOpen() {
      deselect();
      sortMenu.close();
    },

    async onSubmit(record) {
      // Persiste antes de animar: se o servidor recusar, nada aparece na
      // estante e a mensagem de erro fica no proprio formulario.
      const saved = await api.add(record);
      details.hide();

      // A animacao NAO e esperada de proposito: assim ela roda ao mesmo tempo
      // em que o painel se esvazia e colapsa, que e o efeito pedido. Esperar
      // aqui deixaria o formulario preenchido e aberto por 1,6 s.
      addRecord(saved)
        .then((placement) =>
          announce(
            `${saved.title} adicionado à estante ${placement.caseIndex + 1}, ` +
              `prateleira ${placement.shelfIndex + 1}.`,
          ),
        )
        .catch((err) => {
          console.error('[app]', err);
          toast('O livro foi salvo, mas não consegui desenhá-lo na estante.');
        });
    },

    async onUpdate(id, patch) {
      const saved = await api.update(id, patch);
      details.hide();
      await updateRecord(saved);
      announce(`${saved.title} atualizado.`);
    },

    async onDelete(id) {
      await api.remove(id);
      details.hide();
      await removeRecord(id);
      announce('Livro removido da estante.');
    },
  });

  details.onEdit = (rec) => {
    details.hide();
    sortMenu.close();
    panel.openForEdit(rec);
  };

  let initial = [];
  try {
    initial = await api.list();
  } catch (err) {
    toast(
      'Não consegui falar com o servidor. Confira se o Docker e o `npm run dev` estão de pé.',
    );
    console.error('[app]', err);
  }

  await initStage(initial);
  if (initial.length) {
    announce(`${initial.length} ${initial.length === 1 ? 'livro' : 'livros'} na estante.`);
  }

  if (import.meta.env.DEV) installDebugHooks({ details, panel });
}

/**
 * So no servidor de desenvolvimento (o `if` some do bundle de producao).
 * Existe para conferir pelo console as coisas que nao da para ver de fora:
 * a contagem de draw calls, a memoria de textura e o empacotamento por largura.
 *
 *   __shelf.seed(12, 600)   -> 12 livros de 600 paginas
 *   __shelf.stats()         -> draw calls, texturas, estantes
 *   __shelf.wipe()          -> limpa o banco
 */
async function installDebugHooks({ details, panel }) {
  const { renderer, booksGroup, camera, scene: sceneRef } = await import(
    './scene/renderer.js'
  );
  const { controls } = await import('./scene/camera.js');
  const { allRecords, caseCount } = await import('./scene/stage.js');

  const r3 = (v) => +v.toFixed(3);

  window.__shelf = {
    camera: () => ({
      posicao: camera.position.toArray().map(r3),
      alvo: controls.target.toArray().map(r3),
      distancia: r3(camera.position.distanceTo(controls.target)),
      aspect: r3(camera.aspect),
      limites: [r3(controls.minDistance), r3(controls.maxDistance)],
      canvas: [renderer.domElement.width, renderer.domElement.height],
      dpr: renderer.getPixelRatio(),
    }),
    /**
     * Renderiza e devolve a cena como data URL. O render tem de acontecer na
     * MESMA tarefa da leitura: com `preserveDrawingBuffer: false` (que e o que
     * queremos em producao) o buffer e descartado no fim do frame.
     */
    snapshot(width = 420, quality = 0.6) {
      renderer.render(sceneRef, camera);
      const src = renderer.domElement;
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.round((width * src.height) / src.width);
      out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', quality);
    },
    /** Posicao de um livro em coordenadas de tela, para simular cliques reais. */
    screenOf(title) {
      const m = booksGroup.children.find((c) => c.userData.record?.title === title);
      if (!m) return null;
      const v = m.position.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return {
        x: r.left + ((v.x + 1) / 2) * r.width,
        y: r.top + ((1 - v.y) / 2) * r.height,
      };
    },
    /** Colocacao calculada de cada livro — valida o empacotamento por largura. */
    layout: () =>
      allRecords().map((r) => {
        const m = booksGroup.children.find((c) => c.userData.record?._id === r._id);
        return {
          id: r._id,
          titulo: r.title,
          paginas: r.pages,
          nota: r.rating,
          espessura: m ? r3(m.scale.x) : null,
          prateleira: m ? m.userData.placement.shelfIndex : null,
          estante: m ? m.userData.placement.caseIndex : null,
          x: m ? r3(m.position.x) : null,
          y: m ? r3(m.position.y) : null,
        };
      }),
    stats: () => ({
      drawCalls: renderer.info.render.calls,
      texturas: renderer.info.memory.textures,
      geometrias: renderer.info.memory.geometries,
      livrosNaCena: booksGroup.children.length,
      livrosNoTotal: allRecords().length,
      estantes: caseCount(),
      ordem: currentSort(),
      tema: document.documentElement.dataset.theme,
    }),
    sort: (by, dir = 'asc') => setSort({ by, dir }),
    /** Abre o cartao numa ancora arbitraria — testa o grampo contra a viewport. */
    card: (index, x, y) => details.show(allRecords()[index], { x, y }),
    edit: (index) => panel.openForEdit(allRecords()[index]),
    async seed(n = 5, pages = 300) {
      for (let i = 0; i < n; i++) {
        const saved = await api.add({
          title: `Livro de teste ${allRecords().length + 1}`,
          author: 'Autor de Teste',
          pages,
          startDate: '2026-01-01',
          rating: (i % 5) + 1,
          review: 'Semeado pelo console.',
        });
        await addRecord(saved);
      }
      return this.stats();
    },
    async wipe() {
      for (const r of [...allRecords()]) await api.remove(r._id);
      location.reload();
    },
    records: allRecords,
  };
}

boot().catch((err) => {
  console.error('[app] falha no boot', err);
  toast('Algo quebrou ao iniciar a estante. Veja o console para o detalhe.');
});
