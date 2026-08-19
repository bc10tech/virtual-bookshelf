import './styles.css';

import { hasWebGL, initRenderer, resizeRenderer, setSceneBackground } from './scene/renderer.js';
import { initControls } from './scene/camera.js';
import { ensureFonts, warmCover } from './scene/cover.js';
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
  setRecords,
} from './scene/stage.js';
import { createPanel } from './ui/panel.js';
import { createPager } from './ui/pager.js';
import { createDetails } from './ui/details.js';
import { createSortMenu } from './ui/sortMenu.js';
import { createTheme } from './ui/theme.js';
import { createSplash } from './ui/splash.js';
import { createGate } from './ui/gate.js';
import { createAccountMenu } from './ui/account.js';
import { createInvitesDialog } from './ui/invites.js';
import { createProfileDialog } from './ui/profile.js';
import { createFriendsDialog } from './ui/friends.js';
import { bootParams } from './bootParams.js';
import * as api from './data/api.js';
import * as invitesApi from './data/invites.js';
import * as usersApi from './data/users.js';
import { me, logout } from './data/user.js';

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

const SERVER_DOWN = 'Não consegui falar com o servidor. Confira se o Docker e o `npm run dev` estão de pé.';

async function boot() {
  const canvas = $('scene');

  // Primeira coisa do boot: a splash ja esta na tela desde o HTML, e daqui em
  // diante ela e a tela de carregamento. `me()` e chamado UMA vez e a promise e
  // compartilhada: a splash espera por ela so ate o teto do config (para o
  // titulo), e o boot espera por ela de verdade (para saber se ha alguem).
  const splash = createSplash($('splash'));
  const session = me();
  splash.intro(session);

  // Tudo o que a URL diz ao boot (`?auth=`, `?welcome=`, `?u=`) e lido UMA vez
  // e a query inteira e apagada: um F5 nao repete o aviso nem reabre o Perfil.
  // O `?u=` e reescrito pelo modo leitura quando ele entra de fato.
  const { auth: flag, welcome, owner } = bootParams(location.search);
  if (location.search) history.replaceState(null, '', location.pathname);

  if (!hasWebGL()) {
    noWebGL();
    await splash.leave(Promise.resolve());
    return;
  }

  // O tema vem ANTES do renderer, porque a tela de entrada tambem precisa dele.
  // O callback so toca a cena depois que ela existe.
  let sceneUp = false;
  const theme = createTheme($('theme'), (t) => sceneUp && setSceneBackground(t));

  let user = null;
  try {
    user = await session;
  } catch (err) {
    toast(SERVER_DOWN);
    console.error('[app]', err);
  }

  // Visitante (401) ou servidor fora: a cena 3D nem e inicializada — nao ha o
  // que desenhar, e a GPU fica quieta. A splash sai revelando a tela de
  // entrada. Login e logout sao navegacoes completas, entao este estado e
  // terminal na vida da pagina.
  if (!user) {
    // `hidden`, nao so cobertos: senao continuariam focaveis por Tab. So o
    // botao de tema fica — a tela de entrada tambem tem claro e escuro.
    $('fab').hidden = true;
    $('corner-left').parentElement.hidden = true;
    $('account').parentElement.hidden = true;
    createGate($('gate')).show(flag);
    await splash.leave(Promise.resolve());
    return;
  }

  initRenderer(canvas);
  sceneUp = true;
  setSceneBackground(theme.theme);
  const stage = canvas.parentElement;
  resizeRenderer(stage.clientWidth || 1, stage.clientHeight || 1);
  initControls(canvas);
  bindPicking(canvas);

  // Carregado antes de qualquer atlas: texto desenhado em canvas com a fonte
  // ainda nao carregada ficaria com o fallback assado na textura para sempre.
  ensureFonts();

  const details = createDetails($('details'));
  details.onClose = () => deselect();

  // A ancora e o ponto da tela onde o usuario clicou: o cartao nasce junto do
  // livro, e se grampeia sozinho para nunca ficar cortado.
  // Na estante de outra pessoa o cartao sai sem "Editar" (a review, sim).
  setOnSelect((rec, anchor) =>
    rec ? details.show(rec, anchor, { editable: !viewing }) : details.hide(),
  );

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

  // Os tres dialogos do canto da conta ocupam o mesmo lugar: abrir um fecha os
  // outros (e o painel, o popover de ordenacao e a selecao).
  const closeOthers = (except) => {
    deselect();
    sortMenu.close();
    panel?.close({ returnFocus: false });
    for (const d of [invites, profile, friends]) {
      if (d && d !== except) d.close({ returnFocus: false });
    }
  };

  // Convites: so o admin tem o dialogo (e o item no menu). Para os outros o
  // objeto nem existe, e o servidor responde 403 de todo jeito.
  const invites =
    user.role === 'admin'
      ? createInvitesDialog($('invites'), {
          ...invitesApi,
          onOpen: () => closeOthers(invites),
        })
      : null;

  const profile = createProfileDialog($('profile'), {
    user,
    save: usersApi.updateMe,
    onOpen: () => closeOthers(profile),
    onSaved: () => announce('Perfil salvo.'),
  });

  const friends = createFriendsDialog($('friends'), {
    me: user,
    list: usersApi.listUsers,
    onOpen: () => closeOthers(friends),
    onView: (person) => viewShelf(person).catch((err) => console.error('[app]', err)),
  });

  // ---- modo leitura: a estante de outra pessoa -----------------------------
  //
  // `viewing` e quem esta sendo visto (null = a minha). Trocar de dono e
  // `setRecords` — o conjunto inteiro passa pelo `syncScene`. `viewSeq` descarta
  // uma resposta atrasada quando se troca duas vezes depressa: a ultima escolha
  // e a que vale, nao a que a rede entregar por ultimo.
  let viewing = null;
  let viewSeq = 0;
  const badge = $('owner-badge');
  const badgeName = badge.querySelector('.owner-badge__name');
  const badgePic = badge.querySelector('.owner-badge__pic');

  function showBadge(person) {
    badgePic.replaceChildren();
    if (person?.picture) {
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = person.picture;
      img.addEventListener('error', () => img.remove());
      badgePic.append(img);
    }
    // Sem foto o circulo vazio so ocuparia espaco.
    badgePic.hidden = !person?.picture;
    badgeName.textContent = person
      ? `Estante de ${person.nickname || person.name || person.handle}`
      : '';
    badge.hidden = !person;
  }

  /** Entra (person) ou sai (null) do modo leitura com os registros ja baixados. */
  function applyView(person, records) {
    viewing = person;
    // `hidden`, nao so coberto: senao o FAB continuaria focavel por Tab.
    $('fab').hidden = Boolean(person);
    showBadge(person);
    history.replaceState(
      null,
      '',
      person ? `${location.pathname}?u=${encodeURIComponent(person.handle)}` : location.pathname,
    );
    return setRecords(records);
  }

  async function viewShelf(person) {
    if (person.handle === user.handle) return goHome();
    const seq = ++viewSeq;
    closeOthers(null);
    details.hide();
    let records;
    try {
      records = await usersApi.booksOf(person.handle);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) return location.replace('/');
      toast(err.status === 404 ? 'Essa estante não existe (mais).' : SERVER_DOWN);
      console.error('[app]', err);
      return;
    }
    if (seq !== viewSeq) return; // trocou de ideia no meio do download
    await applyView(person, records);
    announce(`Estante de ${person.nickname || person.name}: ${records.length} livros.`);
  }

  async function goHome() {
    const seq = ++viewSeq;
    closeOthers(null);
    details.hide();
    let records;
    try {
      records = await api.list();
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) return location.replace('/');
      toast(SERVER_DOWN);
      console.error('[app]', err);
      return;
    }
    if (seq !== viewSeq) return;
    await applyView(null, records);
    announce('De volta à sua estante.');
  }

  badge.addEventListener('click', () => goHome().catch((err) => console.error('[app]', err)));

  const account = createAccountMenu({
    toggle: $('account'),
    menu: $('account-menu'),
    user,
    isViewing: () => Boolean(viewing),
    onProfile: () => profile.open(),
    onHome: () => goHome().catch((err) => console.error('[app]', err)),
    onFriends: () => friends.open(),
    onInvite: () => invites?.open(),
    async onLogout() {
      try {
        await logout();
      } catch (err) {
        console.error('[app]', err);
      }
      // Recarrega mesmo se o POST falhou: o cookie pode ja ter morrido do lado
      // de la, e a pagina limpa e o unico estado seguro depois de "Sair".
      location.replace('/');
    },
  });

  // O retorno do painel e guardado: e por ele que o botao "Editar" do cartao
  // reabre o formulario num registro que ja existe.
  const panel = createPanel({
    // Abrir o formulario limpa a selecao: o cartao de detalhes some junto com o
    // livro levantado, e os outros popovers se recolhem.
    onOpen() {
      deselect();
      sortMenu.close();
      account.close();
      for (const d of [invites, profile, friends]) d?.close({ returnFocus: false });
    },

    // Escolheu um resultado: as capas (-M da estante, -L da apresentacao)
    // comecam a baixar ja, enquanto o resto do formulario e preenchido.
    onChoose(selection) {
      if (selection.coverUrl) warmCover(selection.coverUrl);
    },

    async onSubmit(record) {
      // Persiste antes de animar: se o servidor recusar, nada aparece na
      // estante e a mensagem de erro fica no proprio formulario.
      const saved = await api.add(record);
      details.hide();
      // Trocou para a estante de um amigo enquanto o POST voava: o livro foi
      // salvo na MINHA, e e la que vai aparecer — nao na cena alheia.
      if (viewing) return;

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
      if (viewing) return; // idem: `updateRecord` faria push no acervo alheio
      await updateRecord(saved);
      announce(`${saved.title} atualizado.`);
    },

    async onDelete(id) {
      await api.remove(id);
      details.hide();
      if (viewing) return;
      await removeRecord(id);
      announce('Livro removido da estante.');
    },
  });

  details.onEdit = (rec) => {
    details.hide();
    sortMenu.close();
    panel.openForEdit(rec);
  };

  // A splash espera por esta promise, entao ela NAO pode rejeitar: um erro aqui
  // vira toast (que aparece por cima da splash, z-index 60 contra 50) e a
  // abertura segue seu curso ate o fim.
  const ready = (async () => {
    let records = [];
    try {
      // `?u=<handle>`: abre direto na estante do amigo — um fetch, sem piscar a
      // minha antes. Se a pessoa nao existe (ou e eu), cai na minha.
      if (owner && owner !== user.handle) {
        const person = (await usersApi.listUsers()).items.find((p) => p.handle === owner);
        if (person) {
          records = await usersApi.booksOf(owner);
          viewing = person;
          $('fab').hidden = true;
          showBadge(person);
          history.replaceState(null, '', `${location.pathname}?u=${encodeURIComponent(owner)}`);
        } else {
          toast('Essa estante não existe (mais). Esta é a sua.');
          records = await api.list();
        }
      } else {
        records = await api.list();
      }
    } catch (err) {
      // Sessao morreu entre o `me()` e o `list()` (raro; ex.: "Sair" noutra
      // aba): recomecar do zero cai na tela de entrada.
      if (err instanceof api.ApiError && err.status === 401) {
        location.replace('/');
        return [];
      }
      toast(SERVER_DOWN);
      console.error('[app]', err);
    }

    try {
      await initStage(records);
    } catch (err) {
      toast('Algo quebrou ao desenhar a estante. Veja o console para o detalhe.');
      console.error('[app]', err);
    }
    return records;
  })();

  await splash.leave(ready);

  const initial = await ready;
  if (initial.length) {
    announce(`${initial.length} ${initial.length === 1 ? 'livro' : 'livros'} na estante.`);
  }

  // Primeiro login: o Perfil abre sozinho, com o primeiro nome do Google como
  // sugestao. Fechar sem salvar e permitido — titulo generico ate preencher
  // pelo menu.
  if (welcome) profile.open({ suggest: welcome.name });

  if (import.meta.env.DEV) {
    installDebugHooks({ details, panel, invites, profile, friends, viewShelf, goHome });
  }
}

/**
 * So no servidor de desenvolvimento (o `if` some do bundle de producao).
 * Existe para conferir pelo console as coisas que nao da para ver de fora:
 * a contagem de draw calls, a memoria de textura e o empacotamento por largura.
 *
 *   __shelf.seed(12, 600)   -> 12 livros de 600 paginas
 *   __shelf.stats()         -> draw calls, texturas, estantes
 *   __shelf.wipe()          -> limpa a MINHA estante
 *   __shelf.splash({ nickname: 'Bruno', gender: 'm' })  -> reprisa a abertura
 *   __shelf.me()            -> o usuario logado, como o servidor o ve
 *   __shelf.view('ana')     -> a estante da ana (modo leitura); .home() volta
 *   __shelf.invites() / .invite(email) / .revoke(email)  -> a allowlist (admin)
 *   __shelf.logout()
 */
async function installDebugHooks({ details, panel, invites, profile, friends, viewShelf, goHome }) {
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
    /**
     * Reprisa a abertura. Sem argumento usa o usuario logado de verdade; com
     * `{ nickname, gender }` simula outro (o apelido so existe no perfil, item
     * 4, entao e assim que se ve a personalizacao hoje). O markup original ja
     * foi removido do DOM na saida, entao aqui ele e remontado igual.
     */
    async splash(user) {
      document.getElementById('splash')?.remove();

      const el = document.createElement('div');
      el.id = 'splash';
      el.className = 'splash';
      const lockup = document.createElement('div');
      lockup.className = 'splash__lockup';
      lockup.hidden = true;
      const logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      logo.setAttribute('class', 'splash__logo');
      logo.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-logo');
      logo.append(use);
      const reveal = document.createElement('div');
      reveal.className = 'splash__reveal';
      const h1 = document.createElement('h1');
      h1.className = 'splash__title';
      reveal.append(h1);
      lockup.append(logo, reveal);
      el.append(lockup);
      document.body.append(el);

      const preview = createSplash(el);
      preview.intro(user === undefined ? me() : Promise.resolve(user));
      await preview.leave(Promise.resolve());
    },
    me,
    /** Modo leitura pelo console: `.view('ana')` abre a estante dela; `.home()` volta. */
    view: async (handle) => {
      const person = (await usersApi.listUsers()).items.find((p) => p.handle === handle);
      if (!person) throw new Error(`handle nao encontrado: ${handle}`);
      await viewShelf(person);
    },
    home: goHome,
    friends: usersApi.listUsers,
    profileDialog: profile,
    friendsDialog: friends,
    invites: invitesApi.list,
    invite: invitesApi.invite,
    revoke: invitesApi.revoke,
    invitesDialog: invites,
    async logout() {
      await logout();
      location.replace('/');
    },
    /** Abre o cartao numa ancora arbitraria — testa o grampo contra a viewport. */
    card: (index, x, y) => details.show(allRecords()[index], { x, y }),
    // `edit` e `seed` nao sabem do modo leitura: na estante de um amigo, `edit`
    // abre o painel num livro que nao e meu (o servidor recusa com 404) e
    // `seed` grava na MINHA e desenha na cena alheia. Ferramenta de DEV; volte
    // com `.home()` antes.
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
  // Ultimo recurso: se o boot morreu antes do `splash.leave`, o overlay ficaria
  // na frente do erro para sempre. O gate idem.
  document.getElementById('splash')?.remove();
  document.getElementById('gate')?.remove();
  toast('Algo quebrou ao iniciar a estante. Veja o console para o detalhe.');
});
