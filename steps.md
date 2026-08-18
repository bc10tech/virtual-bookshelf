# Roteiro: um app para mim e poucos amigos

> Este arquivo passou a ser versionado em agosto de 2026. Antes ficava no
> `.gitignore` porque era um roteiro pessoal para levar o projeto a produção;
> com o pivô abaixo ele virou o documento de rumo do projeto, e faz sentido
> que acompanhe o código.

## O pivô

O projeto foi conduzido até aqui como se fosse virar um site público: orçamento
de bytes, duas barreiras de validação, roteiro com CSP, rate limit, CI, SEO,
monitoramento. **A meta mudou.** O que se quer agora é um aplicativo prazeroso
de usar, para mim e para um punhado de amigos — cada um com a sua estante, e
cada um podendo ver o que os outros leram e estão lendo.

Isso muda o critério que decide as coisas:

- **Deixa de ser meta**: preparo para tráfego em massa, hardening completo,
  orçamento de bytes como critério de toda escolha, CI, SEO/pré-render,
  monitoramento. Nada disso é errado; é só que não paga o próprio custo para
  cinco pessoas.
- **Passa a ser meta**: login que se configura em cinco minutos e funciona no
  celular; perfil e amigos; e principalmente uma interface e uma cena 3D que
  dêem prazer de olhar e de usar. Peso continua sendo bom senso (ninguém quer
  um app lento), mas não é mais o juiz.
- **Continua valendo**: sem framework, sem bundler além do Vite, render sob
  demanda, `config.js` como fonte única de números, e as duas validações — já
  existem, não custam nada e é justamente com dados de outras pessoas que a
  segunda barreira passa a valer a pena.

O que existe hoje: um Express sem autenticação falando com um MongoDB (local
em container, ou o Atlas M0 já migrado), e um front que fala com
`/api/v1/books` sem noção de usuário — o `userId` já existe em todo documento
e em todo filtro, valendo `null`. Os itens 1 e 2 abaixo estão feitos e ficam
como registro das decisões; do 3 em diante é o caminho novo.

---

## 1. Backend e API — ✅ feito

- ✅ **Versionamento**: as rotas de dado vivem em `/api/v1/books`. O
  `/api/health` ficou **fora** da versão de propósito — é endpoint de operação,
  não contrato de dado.
- ✅ **Paginação por cursor** em `GET /api/v1/books`:
  `?cursor=<order>&limit=<n>` → `{ items, nextCursor }`. O servidor pede um
  documento a mais que o pedido para saber se há próxima página sem uma segunda
  consulta, e o índice `{ userId: 1, order: 1 }` de `db.js` já cobre o filtro.

  **Não é `?case=`, e não pode ser.** O servidor não tem como saber onde uma
  estante termina: `computeLayout()` empacota por *largura acumulada* e
  `sortRecords()` ordena no cliente. Paginar por estante obrigaria o servidor a
  replicar `bookThickness()` e as coordenadas de `SHELF`, criando uma segunda
  fonte para números que só o `config.js` deve ter.

  No cliente, a paginação **morre dentro do `api.list()`**: ele percorre as
  páginas e devolve um array só. O dia em que valer a pena desenhar a estante
  antes de o acervo inteiro chegar, é esse laço que muda — mas só funciona com
  a ordenação `order`, porque qualquer outro critério precisa do acervo
  completo antes de ordenar.
- ✅ **`server/validate.js` é `zod`.** Três coisas ficaram amarradas de
  propósito e não devem ser "limpas" depois:
  - **Nada de `.strict()`.** O cliente manda `id` no corpo do POST e o
    `books.js` lê esse campo por fora do valor validado; reprovar chave
    desconhecida quebraria todo cadastro. O strip padrão do `z.object` é o
    comportamento correto, e é ele que joga fora um `_id`/`userId`/`order`
    vindo do cliente.
  - **As mensagens de erro em português são conteúdo de interface.** O
    `request()` do cliente lança `Error(body.error)` e o painel mostra esse
    texto no formulário.
  - **`coverSource` é derivado, nunca aceito do cliente** — e no PATCH só
    aparece se `coverUrl` veio junto, senão um patch de nota apagaria a
    procedência da capa.

  A coerência `endDate >= startDate` está em dois lugares por necessidade: no
  schema, para o que vem no mesmo corpo; e em `books.js`, para o PATCH que
  manda uma data e compara com a outra já gravada. O `isIsoDate` tem três
  condições **em ordem**: o `Date.parse` precisa vir *antes* do round-trip,
  porque `new Date(NaN).toISOString()` lança `RangeError` — e como o zod só
  captura `ZodError`, o throw atravessaria o `safeParse` e viraria 500 onde
  hoje há um 400 com mensagem de formulário.

## 2. MongoDB: do container ao Atlas — ✅ feito

O `docker-compose.yml` local continua sendo o ambiente de desenvolvimento. O
cluster **M0** está de pé em `virtual-bookshelf-clust.8zlawqz.mongodb.net`, com
o acervo migrado e a segunda barreira ativa.

- ✅ **Validação de schema no banco.** `$jsonSchema` em `server/schema.js`,
  `validationLevel: 'strict'`, `validationAction: 'error'`,
  `additionalProperties: false`, dezesseis chaves em `required`.

  **`strict`, não `moderate`.** `moderate` isentaria para sempre os documentos
  que já estivessem inválidos quando o validador entrou — um conjunto invisível
  que ninguém consegue enumerar depois (no M0 nem o log do `mongod` é
  acessível). Barreira com exceção silenciosa não é barreira. O preço é que um
  documento inválido pré-existente fica **impatchável** — daí o pré-check
  obrigatório no `setup`.
- ✅ **Os limites moram num lugar só.** `server/limits.js` é lido pelo zod *e*
  pelo `$jsonSchema`. O invariante: **o validador do banco só pode ser igual ou
  mais frouxo que o zod, nunca mais estrito** — `maxLength` do Mongo conta code
  points e o `.max()` do zod conta unidades UTF-16; o `$` do PCRE casa antes de
  um `\n` final e em JS não. As duas assimetrias caem para o lado seguro.
- ✅ **Índices: um só** (`{ userId: 1, order: 1 }`), porque só ele tem
  consulta. Os outros dois que a lista antiga pedia estão justificados em
  comentário no `schema.js` para o dia em que a consulta aparecer.
- ✅ **`scripts/db.mjs`** com `check`, `setup` e `migrate`. `migrate` não usa o
  `POST` porque isso reatribuiria `order` e reescreveria `createdAt` — usa
  `replaceOne` + `upsert`, é re-executável (segunda passada grava 0), e o
  `--user` já existe para o dia do backfill.
- ✅ **O validador não é aplicado no boot da aplicação.** `collMod` exige
  `dbAdmin` e a aplicação usa `readWrite`. Quem aplica é o script, com a
  credencial de operação; o `createIndex` do boot só roda em banco local.
- ✅ **`$jsonSchema` como operador de query** é o `check`: `find({ $nor: [{
  $jsonSchema }] })` lista o que o validador reprovaria, com privilégio de
  leitura, antes de aplicá-lo. `warn` não serve num M0 (o aviso vai para um log
  que não dá para baixar).
- ✅ **`rating: 0` é int32 e `0.5` é double** no BSON; por isso o schema usa
  `bsonType: 'number'`.

**Duas coisas a saber antes de esbarrar nelas:**

- Com `additionalProperties: false`, **campo novo no livro é deploy em dois
  passos**: alargar `schema.js` e rodar `db.mjs setup` **antes** de subir o
  código que escreve o campo.
- O `userId` está declarado como `['string','null']` de propósito, para o
  validador sobreviver ao período sem login. Enquanto a união existir, o banco
  **não pega** um `userId` esquecido. Apertar é parte do item 3.

**Os dois ⚠️ da versão anterior, reavaliados pelo pivô:**

- Os papéis dos dois usuários do Atlas estão largos (`app-rw` é
  `readWriteAnyDatabase`, o de operação é `atlasAdmin`). Para uso pessoal, é
  aceitável. **Rotacionar as duas senhas continua obrigatório** — elas passaram
  por um chat. Ajuste de console, não de código.
- Allowlist de IP: o host de deploy (item 7) não tem IP fixo, então vai ser
  `0.0.0.0/0` **de propósito** — e nesse caso a credencial é a única defesa do
  banco. Por isso, na hora de subir o login, escopar o `app-rw` para
  `readWrite` **só** em `virtual_bookshelf` deixa de ser cosmético e vira o
  gesto mínimo que se faz junto.

## 3. Login com Google — o próximo passo

O objetivo é: **cinco minutos de configuração, zero senha para guardar, e
funcionar igual no celular.** A recomendação:

- **Fluxo *Authorization Code* com redirect**, no servidor:
  `GET /auth/google` monta a URL e redireciona; o Google volta em
  `GET /auth/google/callback?code=…`; o servidor troca o `code` pelo
  `id_token`, verifica, cria a sessão e redireciona para `/`. Implementar com
  `google-auth-library` (`OAuth2Client.generateAuthUrl` / `getToken` /
  `verifyIdToken`) — é a biblioteca oficial, servidor-only, não pesa no
  bundle. **Nenhum script externo no cliente**: a tela de entrada é um botão
  que aponta para `/auth/google`. Isso é o que faz funcionar em qualquer
  browser de celular sem popup bloqueado.

  Configuração necessária, e é *toda* a configuração: criar um "OAuth client
  ID" (tipo *Web application*) no Google Cloud Console, registrar
  `<BASE_URL>/auth/google/callback` como redirect URI, e três variáveis no
  `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`. Para
  desenvolver, `BASE_URL=http://localhost:5173` — o Vite faz proxy de `/auth`
  para o Express do mesmo jeito que faz de `/api` (acrescentar o prefixo no
  `vite.config.js`).

- **Sessão em cookie, guardada no Mongo.** Token aleatório de 32 bytes
  (`crypto.randomBytes`), cookie `vb.sid` `httpOnly; Secure; SameSite=Lax;
  Path=/`, e uma coleção `sessions` `{ _id: token, userId, createdAt,
  expiresAt }` com índice TTL em `expiresAt` (30 dias, renovado a cada uso).
  Sem `express-session`, sem `passport`, sem JWT — um `findOne` por request num
  índice de chave primária é nada, e o cookie `httpOnly` significa que um XSS
  não rouba a sessão (o que não seria verdade para um JWT no `localStorage`).
  Parse do cookie à mão são cinco linhas; `cookie-parser` se preferir.
  `Secure` só em produção (em `localhost` o cookie não seria gravado).

- **Allowlist administrável pelo app** — este é o pedido central: **liberar um
  e-mail do celular, sem tocar em `.env` nem em console.**
  - Coleção `invites` `{ _id: <e-mail em minúsculas>, invitedBy, createdAt }`.
  - No callback do Google, o `email` do `id_token` (só com
    `email_verified: true`) precisa estar em `users` **ou** em `invites`;
    senão o servidor responde uma página "sua conta ainda não foi convidada"
    e não cria nada. Quando está em `invites`, o `users` é criado e o convite
    pode ficar como registro.
  - Bootstrap: `ADMIN_EMAIL` no `.env` é o único e-mail que entra sem convite,
    e a conta criada com ele ganha `role: 'admin'`. Só o admin vê, no menu de
    perfil, o item **"Convidar"**: um campo de e-mail → `POST /api/v1/invites`
    (403 para quem não é admin). É uma tela de um campo, funciona de qualquer
    aparelho logado. `GET /api/v1/invites` lista e `DELETE /api/v1/invites/:email`
    revoga (revogar não derruba quem já entrou; para isso, apagar as sessões
    do usuário).

- **Coleção `users`**: `{ _id: <sub do Google>, email, name, picture, handle,
  role, createdAt, lastSeenAt }`. `handle` derivado da parte local do e-mail
  (`bcesar97.bc` → `bcesar97-bc`), único, editável depois no perfil. Foto do
  Google guardada como URL — é servida por eles, não passa pelo nosso host.
  Ganha também `nickname` (Apelido, editável no perfil — é o que a splash usa
  para personalizar o título) e `gender` (`'m'|'f'|null`, também do perfil). O
  limite de tamanho do `nickname` mora em `server/limits.js`, como todo número
  compartilhado entre zod e `$jsonSchema` — nunca repetido nos dois.

- **O que muda no código que já existe** — o ponto de contato é pequeno e já
  estava marcado:
  - `server/books.js:9`: `owner()` vira `owner(req)` → `req.user._id`, em cinco
    call sites (GET, POST ×2, PATCH ×2, DELETE). No POST, o `userId` é
    escrito **antes** do spread do valor validado, de propósito: nada que
    venha do cliente sobrescreve o dono.
  - Middleware `requireUser` (lê o cookie, busca a sessão, põe `req.user`)
    montado em `/api/v1`, com `401` JSON. `/api/health` continua fora.
  - `src/data/api.js`: `401` faz o `list()` **abortar o laço de páginas** (não
    só a página corrente) e o `main.js` mostra a tela de entrada — um
    `<section>` com nome do app, uma linha de explicação e o botão "Entrar com
    Google". `GET /api/v1/users/me` é chamado antes do `api.list()`.
    **Já existe consumidor**: `src/data/user.js` (`me()`) chama essa rota para
    personalizar o título da splash e hoje trata *qualquer* erro (404, porque
    a rota não existe ainda) como `null`. Quando a rota nascer com `401` para
    visitante, `401 -> null` continua sendo a resposta certa — não precisa
    mudar `user.js`, só a splash passa a mostrar o nome de verdade.
  - **Rotas de `/auth` registradas antes do fallback do SPA**
    (`server/index.js:50`, o `app.get(/^(?!\/api\/).*/)`), senão o callback
    recebe `index.html`.
  - `Sair`: `POST /auth/logout` apaga a sessão e o cookie.

- **Migração, nesta ordem**: (1) entrar uma vez para o `users` nascer e o `sub`
  ficar conhecido; (2) `db.mjs migrate --user <sub>` para carimbar os livros
  que hoje têm `userId: null`; (3) apertar `userId` para `bsonType: 'string'`
  no `schema.js` (o TODO está lá) e rodar `db.mjs setup`. Na ordem inversa, o
  `setup` se recusa a aplicar (o `check` acusa os `null`), o que é o
  comportamento certo.

- Ainda em `db.mjs setup`: criar as coleções `users`, `sessions` e `invites`
  com um `$jsonSchema` mínimo cada (o mesmo mecanismo do `books`) e os índices
  (`sessions.expiresAt` TTL, `users.email` único, `users.handle` único).

## 4. Perfil e amigos

O modelo é o mais simples que atende o pedido: **todo mundo que está logado se
vê.** A allowlist *é* o convite; não há pedido de amizade, aprovação, bloqueio.
Se um dia isso apertar, uma coleção `follows` entra na frente sem mexer no
resto.

- **API**: `GET /api/v1/users/me`; `GET /api/v1/users` (lista de todo mundo,
  com `handle`, `name`, `picture` e contagens); `GET /api/v1/users/:handle/books`
  — a **mesma** listagem paginada de `books.js`, com o filtro
  `{ userId: <do handle> }`, somente leitura. Escrita continua só em
  `/api/v1/books` e sempre com `{ _id, userId: req.user._id }` no filtro.
- **Cliente**:
  - O canto superior esquerdo é o único livre (`index.html`: FAB no superior
    direito, ordenação no inferior esquerdo, tema no inferior direito, chips
    das estantes no topo-centro). Ali vai o **avatar**, que abre um menu:
    *Minha estante · Amigos · Convidar (admin) · Sair*.
  - **Amigos** é uma lista simples: foto, nome, "lendo agora: *título*",
    "N lidos em 2026". Tocar abre a estante da pessoa.
  - **Modo leitura**: a estante de outra pessoa é a mesma cena, com o FAB
    escondido e o cartão de detalhes sem "Editar/Excluir" (a review aparece
    normalmente — é o que se quer ver). Um selo discreto no topo diz de quem é
    a estante e um toque volta para a minha. URL `?u=<handle>` para abrir
    direto (e para mandar o link no WhatsApp).
  - **"Lendo agora"** = `startDate` sem `endDate`. Vale mostrar isso na própria
    cena: o livro em leitura fica um pouco puxado para a frente na prateleira
    (a mesma mecânica do `SELECT_LIFT_Z`, permanente) — sem custo, e a estante
    conta a história sozinha.
  - **Trocar de dono** troca o conjunto inteiro de registros: é um
    `initStage`-like que passa por `syncScene`. Respeitar `pendingIds` (a
    janela do download das capas) exatamente como hoje — é o mesmo bug de
    duplicação de meshes esperando para acontecer.
  - `editionKey` salgado com o `userId` (previsto em `layout.js:28`) faz a
    mesma obra ter alturas diferentes em estantes diferentes. Opcional; não é
    prioridade.

## 5. Interface e experiência — o item da vez

A ordem aqui é a do que dá mais prazer por hora investida.

- ✅ **Esta rodada, na cena** (ver a análise de custo no plano): capa inteira na
  apresentação (a profundidade do livro passa a seguir a proporção real da
  capa); apresentação nítida com a capa `-L`, só durante o 1 s em que ela é
  vista de frente; textura de madeira procedural na estante (0 KB de asset,
  3 draw calls iguais); lombada legível com o atlas em 512 px no desktop.
- ✅ **Splash de abertura** (`src/ui/splash.js`): logo entra, o título "Estante
  Virtual" (personalizado com o apelido quando há usuário) emerge de trás dela
  enquanto desliza para a esquerda, e o conjunto inteiro sai revelando a
  estante — tudo em CSS, sem lib de animação. É também a tela de carregamento:
  só sai quando o título terminou **e** a estante está pronta. Refinamento
  futuro: hoje `ready` espera o `initStage` inteiro (estante montada **e**
  todas as capas baixadas); o dia em que isso pesar, trocar para esperar só a
  ESTRUTURA montada (livros posicionados, capas chegando por trás da estante
  já revelada) — o teto `MAX_WAIT_MS` já cobre servidor lento nos dois casos.
- **Cabeçalho/perfil** (item 4) e a tela de entrada do login (item 3) — essa é
  a tela pós-splash para quem não está autenticado, não a splash em si.
- **Cartão de detalhes** mais rico: capa grande, datas em texto ("lido em 12
  dias, em março"), estrelas, review com tipografia de página.
- **Painel de cadastro no celular**: hoje funciona; o que falta é fluidez —
  teclado empurrando o formulário, o autocomplete com alvo maior, o botão de
  confirmar sempre visível.
- **Página de estatísticas**: lidos por mês/ano, páginas, nota média, tempo
  médio de leitura. HTML simples, sem biblioteca de gráfico (barras em CSS).
- **Focus trap** no painel; auditoria de contraste com ferramenta.
- **Lista `/lista` sem WebGL** como plano B para aparelho sem GPU — hoje ele
  só vê uma mensagem.
- Temas de estante (outra madeira, outra parede) e imagem compartilhável da
  estante — depois.

## 6. Segurança: só o essencial

O que fica é o que protege dados de outras pessoas dentro do app; o resto sai
do roteiro.

- **Autorização em toda escrita**: filtro sempre `{ _id, userId: req.user._id }`.
  Sem isso, qualquer amigo edita o livro de outro sabendo o id. É a única
  regra nova que não é opcional.
- Leitura de estante alheia **só** pela rota própria e **só** logado. Não
  existe estante pública.
- **Cookie `httpOnly`** (item 3). **XSS**: toda string de usuário chega ao DOM
  por `textContent`, `innerHTML` proibido — a regra já vale e o cartão de
  detalhes é o lugar que mais importa, porque é onde a review de *outra
  pessoa* aparece.
- **Injeção NoSQL**: `isValidId()` força string; nunca passar objeto do cliente
  para um filtro. Já vale.
- Limite de corpo de 16 KB: manter.
- **Sai do roteiro**: CSP/Helmet/HSTS, rate limiting, proxy e cache de capas
  (as capas continuam vindo direto da Open Library, e o disjuntor de `cover.js`
  continua sendo a defesa contra a queda deles), Sentry/monitoramento, SEO,
  pré-render, CI com orçamento de bytes, CORS (front e API são da mesma
  origem).

## 7. Deploy simples

**Um host só**, servindo Express + `dist/` — o `server/index.js` já faz isso
quando o `dist/` existe. Render, Fly.io ou Railway no plano básico servem;
Atlas já está de pé. Segredos (`MONGODB_URI`, `GOOGLE_*`, `ADMIN_EMAIL`,
`BASE_URL`) nas variáveis da plataforma. `BASE_URL` é o domínio que o host der
(ou um domínio próprio) — e é ele que vai no redirect URI do Google. Sem CI:
`npm run build` local antes de subir basta. Não há *cold start* que importe
para cinco pessoas.

## 8. Dados

- O M0 **não tem backup**. Rede de segurança: uma rota `GET /api/v1/books/export`
  que devolve o JSON da própria estante (é o "exportar minha estante"), e um
  `mongodump` de vez em quando. O banco local continua sendo cópia viva do
  acervo original.
- Exclusão de conta: apagar `users`, `sessions` e os `books` do `userId`. Uma
  rota, para quando algum amigo pedir.

---

## Notas de manutenção da fase 1

Coisas que não são óbvias e que vão custar tempo se forem esquecidas:

- **`?default=false` nas URLs de capa é obrigatório.** Sem ele, uma obra sem capa
  devolve `200` com um placeholder em branco, e o livro aparece branco sem
  nenhum erro no console.
- **`img.crossOrigin = 'anonymous'` é obrigatório.** A Open Library manda o
  cabeçalho CORS, mas sem o atributo o browser contamina o canvas assim mesmo, e
  `getImageData` e o upload para WebGL passam a lançar `SecurityError`.
- **O disjuntor de capas só abre por timeout e só fecha por imagem.**
  `onerror` é o 404 normal de obra sem capa. E os downloads que **não** são o
  atlas da estante (pré-aquecimento ao escolher um resultado, capa `-L` da
  apresentação) passam por `loadImageQuiet`, que não toca no disjuntor: uma
  `-L` lenta não pode apagar as capas `-M` de uma estante saudável.
- **O texto das lombadas é assado na textura.** Se a Bitter não estiver
  carregada na hora de desenhar o atlas, a fonte de fallback fica gravada para
  sempre. Por isso `ensureFonts()` roda antes de qualquer atlas — e recebe o
  título, para que o subset `latin-ext` seja baixado só quando algum título
  precisar dele.
- **O atlas é desenhado em unidades (256), não em pixels.** As células e os
  tamanhos de fonte do `config.js` estão nessa grade; o canvas real pode ter
  256, 512 ou 1024 px, e um `ctx.scale` cuida do resto. Os UVs da geometria
  compartilhada usam as unidades e nunca mudam.
- **A profundidade do livro segue a proporção da capa** (por edição, via
  `rememberCoverAspect`), e só é conhecida depois do download. Isso é seguro
  porque `depth` nunca entra no empacotamento — só `thickness`. Quem cria mesh
  precisa reler as dimensões depois da textura (`refreshDims` no `stage.js`).
- **Nunca descartar `bookGeometry`.** Ela é compartilhada por todos os livros. O
  que precisa de `dispose()` é a textura de cada um (`material.map`).
- **Nada de geometria é persistido.** Espessura vem das páginas, altura de um
  hash FNV-1a determinístico da edição, profundidade da capa (ou do hash, sem
  capa), e estante/prateleira/x do empacotamento por largura. Por isso um
  reload reproduz a estante idêntica — e por isso o schema do Mongo é limpo.
- **`crypto.randomUUID` não existe fora de secure context.** Ao testar no celular
  por `http://192.168.x.x:5173` ele seria `undefined`; o `uid()` em
  `src/config.js` já tem o fallback.
- **A renderização é sob demanda.** Se você adicionar algo que muda a cena e ele
  não aparecer, quase certamente falta chamar `invalidate()`.
- **`__shelf` no console** (só em `npm run dev`): `seed(n, paginas)`,
  `stats()`, `camera()`, `layout()`, `snapshot()`, `wipe()`.
