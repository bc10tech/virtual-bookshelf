# virtual-bookshelf

Estante de livros virtual em 3D (Three.js + JS puro no cliente, Express +
MongoDB no servidor). Sem framework, sem bundler além do Vite. Peso e
responsividade são os critérios que decidem toda escolha técnica — veja
`README.md` para o resumo do produto e o orçamento de bytes.

## Rodando localmente

```bash
docker compose up -d && npm install && npm run dev
```

Interface em `:5173` (Vite, proxy de `/api` para o Express), API em `:3000`.
`npm run build && npm start` serve tudo pela porta 3000. `npm run dev -- --host`
para testar em celular na rede local.

## Arquitetura

```
src/config.js       fonte única de TODO número: coordenadas da estante, curva
                     páginas→espessura, tamanhos de fonte do canvas, tempos de
                     animação, cores. Mudar um número é sempre aqui.
src/scene/          Three.js: renderer.js (loop sob demanda), camera.js
                     (OrbitControls), shelf.js (estante procedural), book.js
                     (mesh + cache de textura), cover.js (atlas da capa),
                     layout.js (empacotamento + editionKey), stage.js
                     (syncScene: reconcilia a cena com o estado)
src/ui/              painel de cadastro/edição, estrelas, cartão de detalhes,
                     paginador, menu de ordenação, tema
src/data/            api.js (CRUD), search.js (Open Library), sort.js
server/              Express + driver oficial do MongoDB (sem Mongoose):
                     validate.js valida a entrada (zod), schema.js valida o
                     documento gravado ($jsonSchema), limits.js é o que os dois
                     dividem, db.js/books.js o resto
scripts/db.mjs       check/setup/migrate — aplica o schema no banco e migra o
                     acervo para o Atlas
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
- **Campo novo no livro é deploy em dois passos.** Com
  `additionalProperties: false`, alargar `schema.js` e rodar `db.mjs setup`
  **antes** de subir o código que escreve o campo. Na ordem inversa, a escrita é
  rejeitada em produção.
- **O validador nunca é aplicado no boot da aplicação.** `collMod` exige
  `dbAdmin`, e a aplicação usa um usuário `readWrite`. Isso é de propósito: quem
  aplica é `scripts/db.mjs setup`, com a credencial de operação. Pelo mesmo
  motivo o `createIndex` do boot só roda quando o banco é local.
- **Fontes são auto-hospedadas e variáveis** (`public/fonts/`, hoje Bitter +
  Karla). Preferir sempre `wght@min..max` no Google Fonts a baixar
  instâncias estáticas — metade dos arquivos, mesma cobertura de peso.
- **`steps.md` fica fora do git** (`.gitignore`) por pedido explícito. Ele
  guarda o roteiro para virar produto real (auth, Atlas, deploy, segurança);
  atualizar conforme o projeto avança, mas nunca versionar.

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
`.sort(criterio, direção)`, `.card(i, x, y)`, `.edit(i)`, `.wipe()`.
