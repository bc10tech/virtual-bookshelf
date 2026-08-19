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

O que existe hoje: um Express com login pelo Google e allowlist administrada
pelo app, falando com um MongoDB (local em container, ou o Atlas M0), e um
front que só desenha a estante de quem está logado — todo filtro leva
`userId`, e o banco recusa livro sem dono. Os itens 1, 2 e 3 abaixo estão
feitos e ficam como registro das decisões; do 4 em diante é o caminho novo.

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
- ~~O `userId` está declarado como `['string','null']` de propósito~~ — apertado
  no item 3: hoje é `string` com o `pattern` do `sub` do Google, e o banco
  **pega** um `userId` esquecido.

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

## 3. Login com Google — ✅ feito

O objetivo era: **cinco minutos de configuração, zero senha para guardar, e
funcionar igual no celular.** O que ficou, e por quê:

- ✅ **Fluxo *Authorization Code* com redirect, no servidor.** `GET /auth/google`
  monta a URL e redireciona; o Google volta em `GET /auth/google/callback?code&state`;
  o servidor troca o `code` pelo `id_token`, verifica, cria a sessão e
  redireciona para `/`. **Nenhum script externo no cliente**: a tela de entrada
  (`#gate`, `src/ui/gate.js`) é um `<a href="/auth/google">` — funciona em
  qualquer browser de celular sem popup bloqueado.

  **Sem `google-auth-library`, sem dependência nova.** A troca do `code` é um
  `fetch` no endpoint de token (`server/auth.js`) e a verificação é ~60 linhas
  puras (`server/oidc.js`: `iss`, `aud`, `exp`, `email_verified === true`,
  `sub`/`email` presentes). **A assinatura não é verificada, de propósito**: o
  token chega pelo canal de trás, por TLS, direto do Google, e a spec OIDC
  dispensa nesse caso. Se um dia o token vier do cliente (One Tap), aí é JWKS.
  `state` anti-CSRF num cookie curto `vb.oauth` (`SameSite=Lax` **obrigatório**
  — a volta do Google é cross-site; `Strict` quebraria todo login), comparado
  com `timingSafeEqual` e apagado no callback com o mesmo `path` do set.

  Configuração, e é *toda* a configuração: um "OAuth client ID" (Web
  application) no Google Cloud Console com `<BASE_URL>/auth/google/callback`
  em redirect URIs, e `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`
  no `.env` (`server/env.js` é o único leitor). Em dev
  `BASE_URL=http://localhost:5173`; o Vite faz proxy de `/auth` como de `/api`.
  **Limitação a saber**: o Google não aceita IP privado como redirect URI, então
  `npm run dev -- --host` + login pelo celular na rede local **não funciona** —
  só depois do deploy (item 7) ou por túnel https. Com escopos só
  `openid email profile`, publicar a tela de consentimento não exige
  verificação (e é melhor que *Testing*, que duplicaria a allowlist em "test
  users").

- ✅ **Sessão em cookie, guardada no Mongo** (`server/session.js`). Token
  `randomBytes(32)` em hex, cookie `vb.sid` `httpOnly; SameSite=Lax; Path=/`,
  coleção `sessions { _id: token, userId, createdAt, expiresAt }` com índice
  TTL em `expiresAt` (30 dias, renovado no uso — só quando a última renovação
  tem mais de um dia, deduzido de `expiresAt`, para não escrever a cada
  request; o `lastSeenAt` do usuário sai na mesma passada). Sem
  `express-session`, `passport` ou JWT. Parse do cookie à mão
  (`server/cookies.js`, testado); a escrita é o `res.cookie` do próprio
  Express. `Secure` vem de `BASE_URL` começar com `https:` — não de `NODE_ENV`.
  `sessions` é a única coleção com BSON `Date` (o TTL só enxerga `Date`).

- ✅ **Allowlist administrável pelo app** — o pedido central, e está de pé:
  liberar um e-mail do celular, sem tocar em `.env` nem em console.
  - Coleção `invites { _id: <e-mail em minúsculas>, invitedBy, createdAt }`.
  - No callback, o e-mail do `id_token` precisa estar em `users` **ou** em
    `invites`; senão o servidor redireciona para `/?auth=nao-convidado&email=…`
    e a tela de entrada mostra "sua conta ainda não foi convidada (e-mail)".
    Nada é criado. Cancelar no Google → `?auth=cancelado`; qualquer outra falha
    → `?auth=erro`. O callback **nunca** responde JSON: é uma navegação.
  - Bootstrap: `ADMIN_EMAIL` no `.env`, **com fallback no código**
    (`bcesar97.bc@gmail.com`, em `env.js`) — app pessoal, zero configuração
    local. A conta com esse e-mail ganha `role: 'admin'` (também num usuário
    que já existia como `user`: o próximo login promove). Só o admin vê, no
    menu da conta, o item **Convidar**: um diálogo com campo de e-mail
    (`POST /api/v1/invites`, 403 para não-admin), a lista de convidados com
    "já entrou"/"convidado em …" e **Revogar** (`DELETE /api/v1/invites/:email`;
    não derruba quem já entrou — para isso, apagar as sessões, item 8).
  - **E-mail é sempre normalizado** (`identity.js`) antes de comparar ou
    gravar — no `_id` do convite, no `ADMIN_EMAIL`, no `email` do token, no
    `:email` do DELETE.

- ✅ **Coleção `users`**: `{ _id: <sub do Google>, email, name, picture, handle,
  role, nickname, gender, createdAt, lastSeenAt }`. `handle` derivado da parte
  local do e-mail (`bcesar97.bc` → `bcesar97-bc`; diacríticos caem, símbolos
  viram hifen; colisão → `-2`, `-3`), único. Foto do Google como URL.
  **`nickname` e `gender` nascem `null`** — a personalização da splash vem
  quando o perfil (item 4, bloco "Perfil — a tela") deixar a pessoa escolher o
  apelido; até lá o título é o genérico. Limites de `nickname`/`handle`/`email`
  em `server/limits.js`.
  `users` também é `additionalProperties: false`: **campo novo de perfil é
  deploy em dois passos**, como no livro.

- ✅ **O que mudou no código que já existia**:
  - `owner()` virou `owner(req)` → `req.user._id` nos seis usos de `books.js`.
    No POST o `userId` foi movido para **depois** do spread do valor validado —
    hoje o zod já faz strip, mas a ordem é o que segura se um dia `userId`
    entrar no shape.
  - `requireUser` (`session.js`) montado em `/api/v1` logo depois do guarda de
    banco (extraído em `ensureDb(onFail)`: JSON 503 para a API, redirect para
    `/auth`), com `401 { error }` e `Cache-Control: no-store`. `/api/health`
    fora.
  - `src/data/api.js` ganhou `ApiError` com `status`; `me()` (`user.js`)
    devolve `null` **só no 401** e relança o resto — é assim que o boot separa
    visitante de servidor fora. **`me()` é chamado uma vez** e a promise é
    compartilhada entre a splash (que só espera até `PREP_MS`) e o boot (que
    espera de verdade). Visitante: a cena 3D **nem inicializa**; a splash sai
    revelando o gate (mesmo fundo, sem costura). O botão de tema continua
    usável no gate; os outros cantos ficam `hidden`.
  - Rotas de `/auth` registradas **antes** do fallback do SPA, e o regex do
    fallback exclui `/auth/` — provado com `npm run build && npm start`.
  - Menu de conta no canto superior esquerdo (`src/ui/account.js`, ícone
    genérico de avatar no sprite, padrão do `sortMenu.js` — que teve as classes
    renomeadas para `.menu*`), com quem está logado, **Convidar** (admin) e
    **Sair** (`POST /auth/logout` + `location.replace('/')`).

- ✅ **`db.mjs`** ganhou o registro `COLLECTIONS` (schema + índices com opções,
  lido também pelo `db.js` — o mesmo objeto nos dois evita
  `IndexOptionsConflict`), `check`/`setup` cobrindo as quatro coleções, e o
  comando **`claim --user <sub> [--local] [--dry-run]`**, que carimba os livros
  com `userId: null`. Existe separado do `migrate` porque `migrate` é cópia
  entre bancos e recusa `--local`. Proteções: exige `--user` no formato de
  `sub` (não aceita e-mail), e o usuário precisa existir no alvo (o `sub` é
  real e a estante vai para alguém que consegue entrar).

- ✅ **Migração**: `userId` apertado para `bsonType: 'string'` +
  `pattern: SUB_RE` e `setup` aplicado no local e no Atlas. Na data (18/08/2026)
  as duas coleções `books` estavam **vazias**, então não houve `claim` a fazer;
  o comando fica pronto para o dia em que houver livro sem dono (ex.: um
  `migrate` de um dump antigo sem `--user`).

- **Testes** (`node --test`): `cookies`, `oidc` (token fabricado: ok, `iss`,
  `aud`, `exp`, `email_verified`, malformado, skew), `identity` (handles,
  truncamento, sufixo), `gate` (`authFlagFromSearch`).

## 4. Perfil e amigos

O modelo é o mais simples que atende o pedido: **todo mundo que está logado se
vê.** A allowlist *é* o convite; não há pedido de amizade, aprovação, bloqueio.
Se um dia isso apertar, uma coleção `follows` entra na frente sem mexer no
resto.

- **API**: `GET /api/v1/users/me` (✅ item 3); `GET /api/v1/users` (lista de
  todo mundo, com `handle`, `name`, `picture` e contagens);
  `GET /api/v1/users/:handle/books` — a **mesma** listagem paginada de
  `books.js`, com o filtro `{ userId: <do handle> }`, somente leitura. Escrita
  continua só em `/api/v1/books` e sempre com `{ _id, userId: req.user._id }`
  no filtro (✅ já é assim). **Perfil**: `PATCH /api/v1/users/me` para
  `nickname`, `gender` e `handle` — campos já existem em `users`, nascem
  `null`; entrada validada por zod (`validateProfile`, na convenção
  `{ ok, value | error }`) com os limites de `limits.js`; `handle` duplicado →
  409 com mensagem de formulário. A resposta é o usuário atualizado, no mesmo
  formato de `GET /users/me`.

- **Perfil — a tela** (é o que faz a splash valer): hoje `nickname` e `gender`
  existem no documento mas ninguém consegue preenchê-los, então todo mundo vê
  o título genérico "Estante Virtual". Mesma casca do diálogo de convites
  (`.panel--left`, sheet no celular), aberta pelo item **Perfil** do menu de
  conta, com três campos:
  - **Apelido** (`nickname`, texto até `MAX.nickname`) — a dica diz para que
    serve: "é assim que a estante te chama na abertura". Abaixo do campo, uma
    **prévia ao vivo** do título com o `splashTitle()` que já existe: "Estante
    Virtual **do Bruno**". Vazio = título genérico.
  - **Gênero** (`gender`) — três opções: *masculino* (`'m'` → "do"),
    *feminino* (`'f'` → "da"), *prefiro não dizer* (`null` → "de"). Serve
    **só** para a preposição da splash, e a tela diz isso; `null` é um estado
    legítimo, não "falta preencher".
  - **Handle** (`handle`) — o identificador da URL da estante (`?u=<handle>`,
    abaixo); `HANDLE_RE` no `pattern` do campo, e "já em uso" vindo do 409.
  - Salvar → `PATCH /users/me` → o `me()` seguinte já vem personalizado, e a
    próxima abertura mostra o apelido. Nada de reload: fechar o diálogo basta.
  - **Quando aparece**: no **primeiro login** (`created: true` em
    `resolveLogin`, exposto ao cliente como um flag no `GET /users/me` ou como
    `?welcome=1` no redirect do callback — decidir na implementação; o
    redirect é mais simples e o `authFlagFromSearch` já lê a URL) o diálogo de
    Perfil abre sozinho depois da splash, com o **Apelido já preenchido com o
    `given_name` do Google** como sugestão (o `id_token` traz `given_name`;
    `verifyClaims` passa a extraí-lo). A pessoa confirma ou muda, e a estante
    aparece atrás. Fechar sem salvar é permitido (título genérico até
    preencher pelo menu). Nas visitas seguintes, só pelo menu.
- **Cliente**:
  - O canto superior esquerdo já tem o botão de conta (✅ item 3:
    `src/ui/account.js`, ícone genérico de avatar, menu com *Convidar (admin) ·
    Sair*). Aqui ele ganha *Perfil · Minha estante · Amigos*.
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
- ✅ **Tela de entrada do login** (`#gate`, item 3): a tela pós-splash para quem
  não está autenticado — logo, nome do app, uma linha e "Entrar com Google",
  com o aviso de "não convidada" quando é o caso. **Perfil** (item 4) fica.
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

- ✅ **Autorização em toda escrita**: filtro sempre `{ _id, userId: req.user._id }`.
  Sem isso, qualquer amigo edita o livro de outro sabendo o id. É a única
  regra nova que não é opcional — e já vale desde o item 3.
- Leitura de estante alheia **só** pela rota própria e **só** logado. Não
  existe estante pública.
- ✅ **Cookie `httpOnly`** (item 3). **XSS**: toda string de usuário chega ao DOM
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
