# virtual-bookshelf

Uma estante de livros virtual em 3D. Você busca o livro, registra quando começou
e terminou de ler, dá uma nota e escreve a review; o livro aparece grande no
centro da tela com a capa real e voa para a prateleira.

A espessura de cada livro vem do seu número de páginas, e a prateleira enche por
**largura ocupada** — quando o próximo não cabe, ele sobe para a de cima.

## Rodando

Precisa de Node 20+ e do Docker Desktop aberto.

```bash
docker compose up -d
```

```bash
npm install && npm run dev
```

- Interface: http://localhost:5173
- API: http://localhost:3000

O `npm run dev` sobe o Express (porta 3000) e o Vite (porta 5173) juntos; o Vite
faz proxy de `/api` para o Express. Para testar no celular pela rede local:
`npm run dev -- --host`.

```bash
npm run build && npm start
```

Depois do build, o próprio Express passa a servir o `dist/`, e a porta 3000
atende o site inteiro.

## Como está montado

```
index.html          casca: canvas, FAB, painel-formulário, chips das estantes
server/             Express + driver oficial do MongoDB (sem Mongoose)
  db.js             conexão única e criação do índice
  validate.js       validação de entrada
  books.js          CRUD em /api/books
src/
  config.js         TODOS os números do projeto moram aqui
  scene/            three.js: renderer, câmera, estante, livros, capas, tweens
  data/             acesso à API e busca na Open Library
  ui/               painel, estrelas, paginador, cartão de detalhes
public/fonts/       Proza Libre (SIL OFL) auto-hospedada
```

**Não há nenhum arquivo de modelo 3D.** A estante nasceu de um `bookshelf.obj`
que era um empilhamento paramétrico perfeitamente regular de cuboides
eixo-alinhados — o passo vertical é exatamente 0,350 m. Por isso as medidas dele
foram transcritas para `src/config.js` e a geometria é montada em
`src/scene/shelf.js`: sai idêntica ao milímetro, custa 0 KB de asset, gasta 3
draw calls em vez de 78 e — ao contrário do arquivo — cresce para mais
prateleiras. As cores também vieram de lá: os valores `Kd` do `.mtl` estão em
`KD`, em `config.js`. Os arquivos originais foram removidos porque tudo o que
importava neles virou código.

## Decisões de peso

O site inteiro carrega em **~139 KB gzip** de código mais ~49 KB de fonte, em 5
requisições. As escolhas que sustentam isso:

| | |
|---|---|
| **Vite** | tree-shaking derruba o three.js de ~330 KB para ~123 KB gzip. Só devDependency: não vai um byte para o cliente. |
| **Estante por código** | 0 KB de asset, 0 KB de loader, 3 draw calls. |
| **Uma BoxGeometry compartilhada** | todos os livros usam a mesma geometria, com os UVs remapeados uma vez para as células do atlas. A estante inteira são 24 vértices. |
| **Um atlas por livro** | capa, lombada, contracapa e miolo no mesmo canvas 256². Um livro = 1 textura = 1 material = 1 draw call. |
| **Render sob demanda** | parado, não existe `requestAnimationFrame` pendente: zero CPU, zero GPU, zero bateria. |
| **Uma estante por vez** | trocar de estante no paginador descarta as texturas da anterior, então a memória de GPU não cresce com o acervo. |
| **Sem GSAP, sem framework, sem datepicker, sem icon font** | um tween de 50 linhas, ~10 elementos no DOM, `<input type="date">` nativo e `<symbol>` SVG inline. |
| **Fonte auto-hospedada** | o cache do browser é particionado por site desde 2020, então o CDN do Google só custaria 2 handshakes e um CSS bloqueante. |

Dependências totais: `three`, `express`, `mongodb`, mais `vite` e `concurrently`
em desenvolvimento.

## Dados

Busca e capas vêm da [Open Library](https://openlibrary.org). A contagem de
páginas (`number_of_pages_median`) chega na mesma requisição da busca, então a
espessura da lombada não custa nenhuma chamada extra.

Cada livro é um documento em `virtual_bookshelf.books`. Nada de geometria é
guardado: espessura vem das páginas, altura e profundidade de um hash
determinístico do id, e a posição do empacotamento por largura — então recarregar
reproduz exatamente a mesma estante.

## Ferramentas de desenvolvimento

Com `npm run dev`, o console expõe `__shelf`:

```js
__shelf.seed(12, 600)   // 12 livros de 600 páginas
__shelf.stats()         // draw calls, texturas, geometrias, estantes
__shelf.layout()        // espessura e posição calculadas de cada livro
__shelf.camera()        // posição, alvo, distância, aspect
__shelf.wipe()          // limpa o banco
```

Nada disso vai para o build de produção.

## Próximos passos

Login, MongoDB Atlas, segurança, deploy e o resto do caminho para virar um site
de verdade estão em `steps.md` (que não é versionado).
