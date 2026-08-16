# virtual-bookshelf

Uma estante de livros virtual em 3D. Você busca o livro, registra quando começou
e terminou de ler, dá uma nota (com meio ponto) e escreve a review; o livro
aparece grande no centro da tela com a capa real e voa para a prateleira.

A espessura de cada livro vem do seu número de páginas, e a prateleira enche por
**largura ocupada**, de cima para baixo — quando o próximo não cabe, ele desce
para a prateleira seguinte. A estante nasce com 3 vãos e cresce até 5; a partir
daí nasce uma estante nova, e chips numerados no topo alternam entre elas.

Clicar num livro abre um cartão ao lado dele com a review e os detalhes, com um
botão para editar ou excluir o registro. Os botões dos cantos inferiores ordenam
a estante e alternam entre modo claro e escuro.

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
  db.js             conexão única; timeout e pool conforme o banco é local ou não
  limits.js         os limites que as DUAS validações dividem
  validate.js       validação de entrada (zod)
  schema.js         validação do documento gravado ($jsonSchema) + índices
  books.js          CRUD em /api/v1/books
scripts/db.mjs      aplica o schema no banco e migra o acervo
src/
  config.js         TODOS os números do projeto moram aqui
  scene/            three.js: renderer, câmera, estante, livros, capas, tweens
  data/             acesso à API, busca na Open Library, ordenação
  ui/               painel, estrelas, paginador, cartão, menu de ordem, tema
public/fonts/       Bitter e Karla (SIL OFL), variáveis e auto-hospedadas
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

## Tipografia

Duas famílias, com uma divisão de responsabilidade estrita:

- **Karla** (sem serifa) governa a **interface** — rótulos, campos, botões,
  menus. É a única família declarada no `body`, e todo o resto herda dela.
- **Bitter** (serifada) aparece só onde o conteúdo **é o livro**: a lombada e a
  capa desenhadas no canvas, a caixa de **Review** (para o texto parecer uma
  página sendo escrita, não mais um campo de formulário) e o **cartão de
  detalhes** inteiro. A única exceção dentro do cartão é o botão "Editar", que
  volta para a sans por ser controle de interface.

As duas são **fontes variáveis**: o descritor `font-weight: 400 700` é um
intervalo, e um arquivo por família cobre os dois pesos e todos os
intermediários. São 2 arquivos e 58,4 KB, contra 4 arquivos e 63,6 KB se fossem
instâncias estáticas.

O site inteiro carrega em **~144 KB gzip** de código mais 58 KB de fonte, em 5
requisições. As escolhas que sustentam isso:

| | |
|---|---|
| **Vite** | tree-shaking derruba o three.js de ~330 KB para ~123 KB gzip. Só devDependency: não vai um byte para o cliente. |
| **Estante por código** | 0 KB de asset, 0 KB de loader, 3 draw calls. |
| **Uma BoxGeometry compartilhada** | todos os livros usam a mesma geometria, com os UVs remapeados uma vez para as células do atlas. A estante inteira são 24 vértices. |
| **Um atlas por livro** | capa, lombada, contracapa e miolo no mesmo canvas 256². Um livro = 1 textura = 1 material = 1 draw call. |
| **Cache de material por livro** | ordenar a estante só recalcula posições: nenhum atlas é redesenhado e nenhuma textura sobe para a GPU de novo. |
| **Render sob demanda** | parado, não existe `requestAnimationFrame` pendente: zero CPU, zero GPU, zero bateria. |
| **Uma estante por vez** | trocar de estante no paginador descarta as texturas da anterior, então a memória de GPU não cresce com o acervo. |
| **Tema por tokens CSS** | a cena só troca a cor de fundo; materiais e luzes são os mesmos objetos nos dois modos. |
| **Fontes variáveis** | 2 arquivos em vez de 4, e o eixo de peso 400–700 inteiro sai de graça. |
| **Sem GSAP, sem framework, sem datepicker, sem icon font** | um tween de 50 linhas, ~10 elementos no DOM, `<input type="date">` nativo e `<symbol>` SVG inline. |
| **Fonte auto-hospedada** | o cache do browser é particionado por site desde 2020, então o CDN do Google só custaria 2 handshakes e um CSS bloqueante. |

Dependências totais: `three`, `express`, `mongodb` e `zod`, mais `vite` e
`concurrently` em desenvolvimento. O `zod` valida o corpo das requisições e é
importado só por `server/`: como o bundle do cliente nunca o alcança, ele não
entra no orçamento de bytes acima.

## Dados

Busca e capas vêm da [Open Library](https://openlibrary.org). A contagem de
páginas (`number_of_pages_median`) chega na mesma requisição da busca, então a
espessura da lombada não custa nenhuma chamada extra.

Cada livro é um documento em `virtual_bookshelf.books`. Nada de geometria é
guardado: a espessura vem das páginas, a altura e a profundidade de um hash
determinístico da **edição** (`olKey`, ou título+autor em cadastro manual), e a
posição do empacotamento por largura. Recarregar reproduz exatamente a mesma
estante — e dois exemplares do mesmo livro ficam geometricamente idênticos, que
é justamente o motivo de a chave ser a obra e não o `_id` do registro.

A ordenação da estante é preferência de visualização, não dado do livro: fica em
`localStorage`, nunca no banco. O campo `order` continua sendo a ordem de
inserção, e serve de desempate estável para todos os outros critérios.

### Duas validações, não uma

A entrada da API é validada por zod (`server/validate.js`) e o documento gravado
é validado pelo próprio MongoDB (`$jsonSchema`, em `server/schema.js`). São
barreiras independentes de propósito: a segunda continua valendo para qualquer
escrita que não passe pelo Express.

Elas não são geradas uma da outra — validam coisas diferentes, já que só o
documento tem `order`, `createdAt` e `userId`. O que compartilham são os
limites, em `server/limits.js`, e uma desigualdade: **o validador do banco só
pode ser igual ou mais frouxo que o zod.** Se ele reprovasse algo que a API
aceita, a defesa viraria a queda.

O validador não é aplicado no boot: trocá-lo é `collMod`, que o papel
`readWrite` da aplicação não tem. Quem aplica é o script, com a credencial de
operação:

```bash
node --env-file-if-exists=.env scripts/db.mjs check   # o que seria reprovado?
```

```bash
node --env-file-if-exists=.env scripts/db.mjs setup   # aplica schema e índices
```

Os dois aceitam `--local` para falar com o container. Há também
`migrate [--dry-run] [--user <id>]`, que copia o acervo preservando `order` e
`createdAt` — coisa que uma migração via `POST` destruiria.

## Ferramentas de desenvolvimento

Com `npm run dev`, o console expõe `__shelf`:

```js
__shelf.seed(12, 600)      // 12 livros de 600 páginas
__shelf.stats()            // draw calls, texturas, geometrias, estantes, ordem, tema
__shelf.layout()           // espessura e posição calculadas de cada livro
__shelf.camera()           // posição, alvo, distância, aspect
__shelf.sort('pages','desc')  // troca a ordenação
__shelf.card(0, x, y)      // abre o cartão numa âncora arbitrária
__shelf.edit(0)            // abre o painel em modo edição
__shelf.wipe()             // limpa o banco
```

Nada disso vai para o build de produção.

## Próximos passos

Login, MongoDB Atlas, segurança, deploy e o resto do caminho para virar um site
de verdade estão em `steps.md` (que não é versionado).
