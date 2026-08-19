# virtual-bookshelf

Estante de livros virtual em 3D (Three.js + JS puro no cliente, Express +
MongoDB no servidor). Sem framework, sem bundler além do Vite. O projeto é
para uso pessoal (eu e poucos amigos): o critério que decide é a experiência
de uso; peso e responsividade continuam sendo bom senso, não juiz — veja
`README.md` para o resumo do produto e `steps.md` para o rumo.

## Rodando localmente

```bash
docker compose up -d && npm install && npm run dev
```

Interface em `:5173` (Vite, proxy de `/api` e `/auth` para o Express), API em
`:3000`. `npm run build && npm start` serve tudo pela porta 3000. `npm run dev
-- --host` para testar em celular na rede local — **mas o login não funciona
por IP privado** (o Google só aceita `localhost` ou https como redirect URI).
`npm test` roda `node --test` sobre `test/` (zero dependência nova).

Login exige `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`BASE_URL` no `.env`
(ver `.env.example`); o redirect URI registrado no Google Cloud Console tem de
ser exatamente `<BASE_URL>/auth/google/callback`. Sem essas variáveis o
servidor sobe, mas ninguém entra.

## Arquitetura

```
src/config.js       fonte única de TODO número: coordenadas da estante, curva
                     páginas→espessura, tamanhos de fonte do canvas, tempos de
                     animação, cores. Mudar um número é sempre aqui.
src/scene/          Three.js: renderer.js (loop sob demanda), camera.js
                     (OrbitControls), shelf.js (estante procedural), wood.js
                     (textura de madeira procedural), book.js (mesh + cache de
                     textura), cover.js (atlas da capa, disjuntor, -L da
                     apresentação), layout.js (empacotamento + editionKey +
                     proporção da capa), stage.js (syncScene: reconcilia a
                     cena com o estado)
src/ui/              painel de cadastro/edição, estrelas, cartão de detalhes,
                     paginador, menu de ordenação, tema, splash.js (abertura,
                     3 fases em CSS) + splashTitle.js (texto puro, testado),
                     gate.js (tela de entrada do visitante; authFlagFromSearch
                     é puro e testado), account.js (menu de conta, canto
                     superior esquerdo), invites.js (diálogo da allowlist)
src/data/            api.js (CRUD + ApiError com status), search.js (Open
                     Library), sort.js, user.js (me/logout), invites.js
src/assets/          fonte dos assets vetorizados (hoje só a logo original em
                     PNG; não entra no build)
server/              Express + driver oficial do MongoDB (sem Mongoose):
                     validate.js valida a entrada (zod), schema.js valida o
                     documento gravado ($jsonSchema, registro COLLECTIONS),
                     limits.js é o que os dois dividem, db.js/books.js o CRUD.
                     Login: env.js (variáveis, num lugar só), oidc.js (URL de
                     auth + verificação do id_token, puro), cookies.js (parse,
                     puro), identity.js (e-mail/handle, puro), session.js
                     (cookie vb.sid + coleção sessions, requireUser/requireAdmin),
                     auth.js (rotas /auth), users.js (/users/me, resolveLogin),
                     invites.js (/invites, só admin)
scripts/db.mjs       check/setup/migrate/claim — aplica schema+índices em todas
                     as coleções, migra o acervo, carimba livros sem dono
test/                node --test — splashTitle, cookies, oidc, identity, gate
```

Não existe `bookshelf.obj`/`.mtl` no repo. A estante é gerada por código a
partir de coordenadas extraídas do modelo original (documentadas em
`config.js`); ela reproduz a geometria ao milímetro e generaliza para N
prateleiras, o que o arquivo não fazia.

## Invariantes — não quebrar sem entender por quê

- **`config.js` é a única fonte de números.** Nunca cravar coordenada, cor,
  tamanho ou duração direto num arquivo de cena ou UI.
- **`editionKey()` (em `layout.js`), não `rec._id`, decide altura/profundidade
  do livro e a paleta da capa procedural.** `_id` é por registro; dois
  exemplares do mesmo livro (mesmo `olKey`) precisam ser geometricamente
  idênticos. Isso já foi bug uma vez.
- **`bookGeometry` (BoxGeometry unitária) nunca é descartada** — é
  compartilhada por todos os livros. Só a textura/material de cada um é
  liberado (`dropBookAssets` em `book.js`).
- **Só a estante ativa fica na memória.** Trocar de estante, editar ou excluir
  um livro libera a textura dele; o cache de material existe para que
  *reordenar* não redesenhe atlas nem suba textura de novo.
- **Renderização é sob demanda.** Nunca adicionar um `requestAnimationFrame`
  contínuo; toda mudança visual passa por `invalidate()` (`renderer.js`). Ao
  mexer em algo que muda a cena, verificar que ainda dá 0 frames em repouso.
- **A splash (`splash.js`) é a tela de carregamento, e é só CSS.** Sem
  `requestAnimationFrame`, sem `tween.js` — classes + `@keyframes`/`transition`,
  durações do `config.js`. Ela só sai quando o título terminou **e** a promise
  `ready` do `main.js` resolveu (ou o teto `MAX_WAIT_MS` estourou); por isso
  `ready` **nunca pode rejeitar** — um erro nela deixaria a splash presa para
  sempre. `z-index: 50`, abaixo dos 60 do toast, de propósito: se o servidor
  cair, o aviso aparece por cima da própria splash.
- **`syncScene()` é assíncrono e reentrante — todo mesh nasce por `pendingIds`.**
  Ele espera o download das capas no meio do caminho, e só escreve em `meshById`
  *depois*. Sem o `pendingIds` (`stage.js`), um segundo `syncScene` que entre
  nessa janela recalcula `missing` sobre um mapa ainda vazio, cria os mesmos
  livros de novo, e o mesh do primeiro fica órfão *dentro* da cena — invisível
  para a limpeza, que itera `meshById`, e desenhado por cima do irmão. A UI é
  ligada em `main.js` **antes** do `initStage`, então basta clicar em ordenar
  enquanto a estante carrega. Isso já foi bug uma vez: 76 meshes para 66 livros.
  Quem criar mesh fora do `syncScene` (é o caso do `addRecord`) tem que marcar o
  id em `pendingIds` pela duração inteira.
- **Capas da Open Library**: `img.crossOrigin = 'anonymous'` é obrigatório
  (senão o canvas fica contaminado e o upload pro WebGL lança
  `SecurityError`), e a URL precisa de `?default=false` (senão uma obra sem
  capa devolve 200 com um placeholder em branco em vez de 404).
- **O disjuntor de capas tem duas regras, e as duas são contraintuitivas**
  (`cover.js`): **só timeout abre** — `onerror` é o 404 normal de obra sem capa,
  e contá-lo mataria as capas de uma estante saudável; e **só imagem fecha** —
  num host fora do ar o browser passa a errar *rápido*, então tratar erro rápido
  como "host de pé" reabre a porta e cada livro paga outro timeout. Se aparecer
  capa procedural onde devia haver capa real, é aqui que se olha primeiro.
- **Fonte é assada na textura do canvas.** `ensureFonts()` precisa terminar
  antes do primeiro atlas ser desenhado, senão o fallback do sistema fica
  gravado permanentemente na lombada.
- **Todo texto de usuário/API vai ao DOM por `textContent`, nunca
  `innerHTML`.** É a única barreira contra XSS na review.
- **Existem duas validações, e a direção entre elas é o invariante.** O zod
  (`validate.js`) valida a entrada; o `$jsonSchema` (`schema.js`) valida o
  documento gravado. O banco só pode ser **igual ou mais frouxo** que o zod —
  nunca mais estrito, senão a segunda barreira derruba em vez de defender.
  Números compartilhados só via `limits.js`; nunca repetir um nos dois. E
  cuidado ao assumir tipo: `rating: 0` chega ao BSON como `int` e `2.5` como
  `double`, por isso é `bsonType: 'number'`.
- **Campo novo no livro — e no usuário — é deploy em dois passos.** Com
  `additionalProperties: false` (`books` e `users`), alargar `schema.js` e rodar
  `db.mjs setup` **antes** de subir o código que escreve o campo. Na ordem
  inversa, a escrita é rejeitada em produção.
- **O validador nunca é aplicado no boot da aplicação.** `collMod` exige
  `dbAdmin`, e a aplicação usa um usuário `readWrite`. Isso é de propósito: quem
  aplica é `scripts/db.mjs setup`, com a credencial de operação. Pelo mesmo
  motivo o `createIndex` do boot só roda quando o banco é local.
- **`COLLECTIONS` (`schema.js`) é o registro de toda coleção, com schema E
  índices (chave + opções).** `db.js` (boot local) e `db.mjs setup` leem o mesmo
  objeto; se um criasse `{ expiresAt: 1 }` sem TTL e o outro com, o Mongo
  recusaria com `IndexOptionsConflict`. Índice novo é sempre ali, nunca num
  `createIndex` solto.
- **Toda rota de `/api/v1` passa por `requireUser`; o dono é sempre
  `req.user._id`** (`owner(req)` em `books.js`), e todo filtro de leitura e
  escrita leva `userId`. É a única regra de autorização do app. No POST, o
  `userId` é escrito **depois** do spread do valor validado — nada do cliente
  sobrescreve o dono. `/api/health` e `/auth` ficam fora.
- **Sessão só em cookie `httpOnly` (`vb.sid`), guardada em `sessions`.** Sem
  JWT, sem `localStorage`: um XSS não rouba a sessão. `Secure` vem de `BASE_URL`
  começar com `https:`, nunca de `NODE_ENV` — em `http://localhost` um cookie
  `Secure` não seria gravado e o login "voltaria" direto para o gate.
  `sessions.createdAt/expiresAt` são BSON `Date` (o TTL só enxerga `Date`); o
  resto do banco usa string ISO.
- **E-mail é sempre `normalizeEmail()` (`identity.js`) antes de comparar ou
  gravar** — `invites._id`, `ADMIN_EMAIL`, o `email` do `id_token`, o `:email`
  do DELETE. Um convite gravado com maiúscula nunca casaria com o que o Google
  devolve, e o sintoma seria "convidei e a pessoa não entra".
- **O `id_token` não tem a assinatura verificada, de propósito** (`oidc.js`): ele
  chega pelo canal de trás (o próprio servidor faz o POST no endpoint de token
  do Google por TLS), caso em que a spec OIDC dispensa. Se um dia o token vier
  do **cliente** (One Tap, botão do Google no browser), aí é JWKS obrigatório.
  `iss`, `aud`, `exp` e `email_verified === true` continuam conferidos.
- **O cookie do `state` (`vb.oauth`) tem de ser `SameSite=Lax`.** A volta do
  Google é navegação cross-site; com `Strict` o cookie não viria e todo login
  falharia com "state não confere". E `clearCookie` só apaga com o **mesmo
  `path`** do `set` — as opções moram num objeto só.
- **Rotas de `/auth` registradas antes do fallback do SPA** (`index.js`), e o
  regex do fallback exclui `/auth/`. Só se manifesta com `dist/` presente: em
  `npm run dev` o Vite serve o front, então um erro de ordem seria invisível
  até o primeiro `npm run build`.
- **`me()` é chamado uma vez no boot e a promise é compartilhada** entre a
  splash (que só espera até `SPLASH.PREP_MS`) e o próprio boot (que espera de
  verdade). Visitante (401) → a cena 3D **nem inicializa**; a splash sai
  revelando o `#gate`. `me()` devolve `null` só no 401 e relança o resto — é
  assim que o boot separa "sem sessão" de "servidor fora".
- **Fontes são auto-hospedadas e variáveis** (`public/fonts/`, hoje Bitter +
  Karla). Preferir sempre `wght@min..max` no Google Fonts a baixar
  instâncias estáticas — metade dos arquivos, mesma cobertura de peso.
- **O atlas é desenhado em unidades (`COVER.UNITS` = 256), não em pixels.**
  Células e tamanhos de fonte do `config.js` estão nessa grade; o canvas real
  (`ATLAS_PX_*`, `PRESENT_PX_*`) é escolhido por ponteiro/DPR e um `ctx.scale`
  cuida do resto. Os UVs da geometria compartilhada usam as unidades e nunca
  mudam com a resolução.
- **A profundidade do livro segue a proporção da capa** (por `editionKey`, via
  `rememberCoverAspect` em `layout.js`), e só é conhecida depois do download.
  É seguro porque `depth` nunca entra no empacotamento — só `thickness`. Quem
  cria mesh precisa reler as dimensões depois da textura (`refreshDims` no
  `stage.js`). A proporção vem **só** da capa `-M`, nunca da `-L` da
  apresentação: as duas diferem por arredondamento, e 1 mm de diferença
  dispararia um reflow de nada no próximo `syncScene`.
- **Download que não é o atlas da estante passa por `loadImageQuiet`**
  (`cover.js`): pré-aquecimento ao escolher um resultado e a capa `-L` da
  apresentação. Ele não toca no disjuntor — com `BREAKER_FAILURES = 1`, uma
  `-L` lenta pelo `loadImage` normal abriria a porta e apagaria as `-M` de uma
  estante saudável por 30 s.
- **`steps.md` é o documento de rumo do projeto e é versionado** (deixou de
  ficar no `.gitignore` em agosto de 2026, junto com o pivô para app pessoal).
  Atualizar conforme o projeto avança.

## Convenções

- Comentários em português, só explicando o *porquê* não óbvio (uma
  constraint escondida, uma decisão que foi revertida, um workaround). Nunca
  descrever o óbvio.
- Sem dependências novas sem justificar o peso — ver a tabela de "decisões de
  peso" no `README.md` antes de propor algo (GSAP, date-picker, ícone-fonte
  etc. já foram descartados com motivo).
- Mudança em UI: sempre conferir depois em claro **e** escuro, desktop **e**
  mobile (o cartão de detalhes e o painel têm comportamento diferente em
  cada).

## Depurando

Com `npm run dev`, o console do browser expõe `__shelf` (não entra no build de
produção): `__shelf.stats()`, `.layout()`, `.camera()`, `.seed(n, páginas)`,
`.sort(criterio, direção)`, `.card(i, x, y)`, `.edit(i)`, `.wipe()`,
`.splash()` (reprisa a abertura; com `{ nickname, gender }` simula outro
usuário), `.me()`, `.invites()`/`.invite(email)`/`.revoke(email)` (admin),
`.logout()`. Só existe depois do login — para visitante o boot para no gate.

Para testar um fluxo logado sem passar pelo Google (ex.: outro usuário), dá
para inserir um documento em `users` e um em `sessions` direto no Mongo local e
gravar `document.cookie = 'vb.sid=<token>; path=/'` no console — o servidor só
lê o cabeçalho `Cookie`. Lembrar de apagar depois: um `users` de teste com o
e-mail do admin faria o login real bater no índice único (`11000`).
