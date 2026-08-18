/**
 * Fonte unica de todos os numeros do projeto.
 *
 * As coordenadas da estante foram extraidas do bookshelf.obj original, que era
 * um empilhamento parametrico perfeitamente regular de cuboides eixo-alinhados.
 * O arquivo nao existe mais no projeto: estes numeros SAO o modelo agora.
 *
 * O passo vertical e exatamente 0.350 m, conferido em dois pontos independentes:
 *
 *     0.075 + 0.350 * 1 = 0.425  = topo de shelf_1   ✓
 *     0.075 + 0.350 * 2 = 0.775  = topo de shelf_2   ✓
 *     0.775 + 0.330 + 0.020 = 1.125 = topo do modelo ✓
 *
 * Por isso a estante e reconstruida por codigo: sai identica ao milimetro,
 * custa 0 KB de asset, 3 draw calls em vez de 78, e — ao contrario do .obj —
 * generaliza para N prateleiras.
 */

// ---------------------------------------------------------------- estante ---

export const SHELF = {
  INNER_MIN_X: -0.34, // face interna da lateral esquerda
  INNER_MAX_X: 0.34,
  OUTER_X: 0.36, // face externa das laterais
  BACK_Z: -0.122, // face frontal do painel de fundo
  BACK_OUTER_Z: -0.13,
  FRONT_Z: 0.13, // face frontal das laterais
  TOP_FRONT_Z: 0.144, // o tampo avanca 14 mm alem das laterais
  SHELF_FRONT_Z: 0.13,
  SHELF_BACK_Z: -0.124,

  PLINTH_H: 0.055, // rodape: 0 .. 0.055
  PLINTH_X: 0.345,
  PLINTH_Z: 0.115,

  FIRST_FLOOR_Y: 0.075, // topo da base = piso da prateleira 0
  PITCH_Y: 0.35, // passo vertical entre pisos
  BOARD_T: 0.02, // espessura de qualquer tabua
  CLEARANCE: 0.33, // altura livre de um vao (0.350 - 0.020)

  MIN_SHELVES: 3, // a estante nasce com 3 vaos, como o modelo original
  MAX_SHELVES: 5, // ao passar disso, nasce uma nova estante (paginador)
};

/** Largura util interna: 0.680 m. */
export const INNER_WIDTH = SHELF.INNER_MAX_X - SHELF.INNER_MIN_X;

/** Altura total de uma estante com `n` vaos. n=3 -> 1.125 (igual ao .obj). */
export const caseHeight = (n) => 0.425 + SHELF.PITCH_Y * (n - 1);

/** Altura do piso do vao `i` (0 = o de baixo). */
export const shelfFloorY = (i) => SHELF.FIRST_FLOOR_Y + SHELF.PITCH_Y * i;

// --------------------------------------------------------------- materiais ---
/**
 * Valores Kd exatos do bookshelf.mtl, tratados como LINEARES.
 *
 * Isto foi decidido olhando o resultado: lidos como sRGB, o walnut (Kd 0.147)
 * vira 0.018 em linear e a estante inteira fica praticamente preta. Lidos como
 * lineares, da um nogueira escuro crivel — que e evidentemente o que o
 * exportador "three-d-stage" quis dizer.
 */

export const KD = {
  walnut: [0.147, 0.0685, 0.0296],
  walnutDark: [0.0685, 0.0319, 0.0144],
  backPanel: [0.2582, 0.1441, 0.0723],
  bookPages: [0.807, 0.7454, 0.624],
  bookFoil: [0.6939, 0.552, 0.2747],
  bookCovers: [
    [0.0802, 0.007, 0.0273],
    [0.15, 0.0252, 0.0343],
    [0.2462, 0.0529, 0.0212],
    [0.305, 0.1413, 0.0513],
  ],
};

/**
 * Madeira procedural da estante (`wood.js`). Um canvas gerado no boot vira o
 * `map` dos materiais walnut: 0 KB de asset, um unico ladrilho, os mesmos 3
 * draw calls. Os tons sao derivados de KD.walnut, entao a cor MEDIA da estante
 * continua a do .mtl; o rodape usa o mesmo mapa com DARK_TINT (a razao
 * walnutDark/walnut por canal), para continuar mais escuro que o resto.
 */
export const WOOD = {
  PX: 512, // ladrilho quadrado; potencia de 2 por causa de repeat + mipmaps
  TILE_M: 0.6, // um ladrilho cobre 0,6 m de madeira ao longo do veio
  SEED: 7, // deterministico: a estante nasce igual a cada reload
  DARK_TINT: KD.walnutDark.map((v, i) => v / KD.walnut[i]),
  ANISOTROPY: 4,

  // Tabuas: laterais, prateleiras, tampo e rodape.
  BOARD: {
    KD: KD.walnut,
    RINGS: 11, // aneis por ladrilho, transversais ao veio
    WOBBLE: 0.6, // quanto os aneis serpenteiam ao longo do veio (em aneis)
    CONTRAST: 0.42, // amplitude claro/escuro em torno do tom base
  },
  // Painel de fundo: a mesma madeira no tom mais claro do .mtl, com poucos
  // aneis largos e contraste baixo. E o fundo dos livros — tem que ter textura
  // para nao parecer plastico, mas nao pode competir com as lombadas.
  PANEL: {
    KD: KD.backPanel,
    RINGS: 4,
    WOBBLE: 0.2,
    CONTRAST: 0.1,
  },
};

/** Transferencia linear -> sRGB, a mesma que o three aplica na saida. */
export const linearToSrgb = (v) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

/**
 * Kd linear do .mtl -> `#rrggbb` para o canvas 2D.
 * O canvas trabalha em sRGB, entao a conversao e necessaria para uma cor
 * desenhada em textura casar com a mesma cor aplicada num material.
 */
export const kdToCss = (kd) =>
  '#' +
  kd
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

// ------------------------------------------------------------------ livros ---

export const BOOK = {
  /**
   * Espessura da lombada a partir do numero de paginas, em metros.
   * Um livro medio de 300 paginas da 0.042 m, e 0.680 / 0.042 ~= 16 livros por
   * prateleira — mas um calhamaco de 600 paginas ocupa o lugar de quase 4
   * livros finos, que era todo o objetivo de amarrar a largura as paginas.
   */
  THICKNESS_BASE: 0.012,
  THICKNESS_PER_PAGE: 0.0001,
  THICKNESS_MIN: 0.018, // ~60 paginas
  THICKNESS_MAX: 0.07, // ~580 paginas ou mais
  DEFAULT_PAGES: 300, // quando a obra nao informa contagem

  GAP: 0.001, // folga entre lombadas

  HEIGHT_MIN: 0.195, // deixa >= 85 mm de folga sob os 0.330 do vao
  HEIGHT_RANGE: 0.05,
  DEPTH_RATIO: 1.55, // profundidade = altura / 1.55
  DEPTH_MIN: 0.12,
  DEPTH_MAX: 0.17,

  /**
   * Todas as lombadas alinhadas neste Z (12 mm atras da face frontal das
   * laterais). O .obj original encostava os livros no fundo; alinhar pela
   * frente faz as lombadas pegarem luz por igual e esconde a borda irregular.
   */
  FRONT_Z: 0.118,

  SELECT_LIFT_Z: 0.03, // quanto o livro selecionado avanca
  SELECT_SCALE: 1.04,
};

export const bookThickness = (pages) => {
  const p = Number.isFinite(pages) && pages > 0 ? pages : BOOK.DEFAULT_PAGES;
  const t = BOOK.THICKNESS_BASE + p * BOOK.THICKNESS_PER_PAGE;
  return Math.min(BOOK.THICKNESS_MAX, Math.max(BOOK.THICKNESS_MIN, t));
};

// ------------------------------------------------------------------ camera ---

export const CAM = {
  FOV: 35,
  MARGIN_Y: 0.16, // folga vertical alem da altura da estante
  FRAME_WIDTH: 0.8, // largura enquadrada (0.720 da estante + folga)
  NEAR: 0.05,
  FAR: 50,
  MIN_DIST_FACTOR: 0.6,
  MAX_DIST_FACTOR: 1.6,
  // Limites do OrbitControls: impedem olhar por baixo do rodape, por cima do
  // tampo, ou girar para tras do painel de fundo (que nao tem outro lado).
  MIN_POLAR: (55 * Math.PI) / 180,
  MAX_POLAR: (100 * Math.PI) / 180,
  AZIMUTH: (35 * Math.PI) / 180,
  REFRAME_MS: 400,
};

/** Metade da tangente do fov vertical: usada em todo calculo de enquadramento. */
export const HALF_TAN = Math.tan((CAM.FOV * Math.PI) / 180 / 2); // 0.31530

// -------------------------------------------------------------------- luzes ---

export const LIGHT = {
  HEMI_SKY: 0xede6d8,
  HEMI_GROUND: 0x2a1b10,
  HEMI_INTENSITY: 1.35,
  DIR_COLOR: 0xfff6e8,
  DIR_INTENSITY: 2.1,
  DIR_POS: [-0.9, 1.4, 1.6],
  /**
   * Unica coisa da cena que muda com o tema: as cores primarias da interface.
   * Materiais e luzes sao identicos nos dois modos — a madeira nao deveria
   * mudar de cor porque a interface mudou.
   */
  BACKGROUND: { light: 0xffffe3, dark: 0x6d8196 },
};

// --------------------------------------------------------------- animacao ---

export const ANIM = {
  PRESENT_MS: 500, // o livro cresce no centro da tela
  HOLD_MS: 500, // parado, capa legivel
  FLY_MS: 600, // arco ate a prateleira, girando para mostrar a lombada
  PRESENT_DIST: 0.9, // distancia da camera na fase de apresentacao
  PRESENT_FILL_H: 0.45, // fracao da altura visivel que o livro ocupa
  PRESENT_FILL_W: 0.6,
  ARC_LIFT: 0.15, // altura do arco da trajetoria
  START_SCALE: 0.6, // nunca 0: escala nao-uniforme zero da matriz normal singular
  SELECT_MS: 300,
  // Livros mudando de lugar (ordenacao, crescimento da estante, exclusao).
  // Sem isto a estante daria um corte seco em vez de ler como movimento.
  REFLOW_MS: 400,
};

export const ANIM_TOTAL = ANIM.PRESENT_MS + ANIM.HOLD_MS + ANIM.FLY_MS; // 1600 ms

/**
 * Splash de abertura (`src/ui/splash.js`). Ela e tambem a tela de carregamento:
 * so sai quando o titulo terminou E a estante ficou pronta (ou o teto estourou).
 * O CSS le as tres primeiras por `--splash-*-ms`; as outras sao so do JS.
 */
export const SPLASH = {
  LOGO_MS: 600, // fase 1: pop-in da logo sozinha, no centro da tela
  TITLE_MS: 500, // fase 2: a logo desliza p/ esquerda e o titulo sai de tras dela
  HOLD_MS: 500, // pausa com o conjunto parado e legivel
  EXIT_MS: 450, // fase 3: a splash inteira sai pela esquerda
  PREP_MS: 1200, // teto para o usuario + a Bitter antes da fase 2
  MAX_WAIT_MS: 4000, // teto para a estante, contado do inicio: passou, sai assim mesmo
};

// -------------------------------------------------------------------- misc ---

/**
 * Um atlas por livro: um canvas, uma CanvasTexture, um material, um draw call.
 * O remapeamento de UV e identico para todo livro, entao ele e assado uma unica
 * vez numa BoxGeometry unitaria COMPARTILHADA — a geometria de uma estante
 * inteira sao 24 vertices.
 *
 * O atlas e desenhado numa grade de UNITS x UNITS (as celulas e os tamanhos de
 * fonte abaixo estao nessa unidade), mas o canvas real pode ter mais pixels: o
 * `cover.js` aplica `ctx.scale(px / UNITS)` e tudo — inclusive o texto, que e
 * vetorial — sai rasterizado na resolucao real. Os UVs da geometria usam UNITS
 * e nunca mudam. Isso permite escolher a resolucao por aparelho sem tocar em
 * nenhum outro numero.
 */
export const COVER = {
  UNITS: 256,
  INSET: 0.5, // meia unidade de recuo evita puxar a cor da celula vizinha
  MAX_ANISOTROPY: 4,

  /**
   * Resolucao real do atlas da estante. No desktop a DPR 2 uma lombada tem
   * ~470 px de tela e o texto de 16 unidades rasterizado a 256 ficava macio
   * (1,8x de ampliacao em repouso, ~3x no zoom); a 512 fica nitido. No celular
   * (ponteiro grosso) o livro tem ~190 px de tela e 256 basta — e cada atlas
   * 512 custa 1,4 MB de GPU contra 0,35 MB, o que numa estante cheia (~80
   * livros) sao 110 MB. Num monitor de DPR 1 a lombada tem ~165 css px < 256
   * texels: 512 nao ganharia nada, entao tambem fica em 256.
   */
  ATLAS_PX_FINE: 512,
  ATLAS_PX_COARSE: 256,

  /**
   * Resolucao do atlas TEMPORARIO da apresentacao (o livro grande no centro da
   * tela ao ser cadastrado). E o unico momento em que a capa e vista de frente
   * e ampla — 45% da altura do viewport, ~970 px de tela num 1080p a DPR 2 —,
   * entao ela e desenhada com a capa `-L` da Open Library (~500x750) num atlas
   * proprio, que dura 1 s e e descartado no pouso. Pagar `-L` no atlas de todos
   * os livros seria 4x de memoria por algo que ninguem ve na estante.
   */
  PRESENT_PX_FINE: 1024,
  PRESENT_PX_COARSE: 512,

  // Teto para UMA capa. Estava cravado no `cover.js`; veio para ca junto com o
  // disjuntor, que so faz sentido lido ao lado dele.
  LOAD_TIMEOUT_MS: 8000,

  /**
   * Disjuntor do host de capas. Quando `covers.openlibrary.org` fica
   * inalcancavel, cada capa gasta o timeout inteiro e uma estante de 66 livros
   * levava 16 s para aparecer. Depois de FAILURES esperas estouradas, as capas
   * seguintes desistem na hora e caem na capa procedural.
   *
   * COOLDOWN_MS e quanto o disjuntor fica aberto antes de deixar UMA capa
   * tentar de novo. 30 s e curto o bastante para a volta ser percebida na mesma
   * sessao, e longo o bastante para nao voltar a pagar o timeout a cada livro.
   *
   * FAILURES = 1, e nao 2, porque as capas sao baixadas por SEIS workers em
   * paralelo (`createBooksBatched`): quando a primeira espera estoura, as
   * outras cinco ja estao condenadas ha oito segundos, entao a segunda falha
   * nao acrescenta informacao nenhuma. Medido: com 2, um retardatario escapava
   * na fresta de milissegundos entre o primeiro e o segundo timeout e sozinho
   * custava mais 6 s — 14 s de estante em vez de 8 s. E um falso positivo sai
   * barato porque a sonda o desfaz em 30 s e as capas voltam sozinhas.
   */
  BREAKER_FAILURES: 1,
  BREAKER_COOLDOWN_MS: 30000,

  /**
   * A celula da capa tem a MESMA proporcao da face do livro (1 / DEPTH_RATIO =
   * 0,645). Era 192x256 (0,75) e a imagem entrava com object-fit cover: uma
   * capa `-M` tipica (180x280, 0,643) perdia ~15% na vertical no corte e ainda
   * saia 14% mais estreita ao ser mapeada na face — dois erros somados. Com a
   * profundidade do livro seguindo a propria capa (`rememberCoverAspect`), a
   * imagem preenche a celula exata, sem corte nem barra.
   */
  CELL_FRONT: { x: 0, y: 0, w: 165, h: 256 }, // capa
  CELL_SPINE: { x: 169, y: 0, w: 32, h: 256 }, // lombada (4 unidades de respiro da capa)

  // Faces de cor chapada: amostradas num PONTO unico em vez de um retangulo,
  // o que torna impossivel qualquer sangramento entre celulas em qualquer
  // nivel de mipmap.
  CELL_BACK: { x: 232, y: 0, w: 12, h: 16 }, // contracapa
  CELL_PAGES: { x: 244, y: 0, w: 12, h: 16 }, // miolo

  // A Bitter e o oposto da Neuton: slab, larga e de x-height grande. Nos mesmos
  // tamanhos ela lia grande demais e truncava os titulos muito antes na lombada,
  // que so tem 32 px de celula — entao os valores desceram.
  SPINE_TITLE_PX: 16,
  SPINE_AUTHOR_PX: 11,
  FRONT_TITLE_PX: 20,
  FRONT_AUTHOR_PX: 12,
  FRONT_TITLE_LINES: 4,
};

export const UI = {
  /**
   * Tema de quem nunca escolheu. E 'dark' por decisao de produto, e NAO segue
   * `prefers-color-scheme`: a estante de nogueira sobre o fundo azul-acinzentado
   * e a cara do app, e o modo claro e a alternativa. Quem clicar no botao fica
   * com a escolha em localStorage. Mudar aqui exige mudar tambem os dois
   * `<meta>` e o `data-theme` do index.html, que existem so para a primeira
   * pintura nao piscar.
   */
  DEFAULT_THEME: 'dark',
  MOBILE_MAX_W: 640,
  SEARCH_DEBOUNCE_MS: 300,
  SEARCH_MIN_CHARS: 3,
  SEARCH_LIMIT: 8,
  CLICK_SLOP_PX: 6, // acima disso o pointerup e arrasto de camera, nao clique
  REVIEW_MAX: 2000,
};

export const OL = {
  SEARCH: 'https://openlibrary.org/search.json',
  COVER: 'https://covers.openlibrary.org/b/id/',
  // `-M` (~180x280, ~14 KB) e o que fica gravado no livro e desenhado no atlas
  // da estante; `-L` (~500x750) so entra no atlas temporario da apresentacao,
  // derivado da URL da `-M` na hora (`cover.js`).
  COVER_SIZE_SHELF: 'M',
  COVER_SIZE_PRESENT: 'L',
  // `fields` e essencial para o peso: a resposta padrao de uma busca comum tem
  // centenas de KB de dados de edicao; recortada assim fica em ~2 KB.
  FIELDS:
    'key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median',
};

/**
 * `crypto.randomUUID` so existe em secure context. Testar no celular por
 * http://192.168.x.x:5173 nao e secure context, e sem esse fallback o primeiro
 * cadastro estouraria com TypeError.
 */
export const uid = () =>
  crypto.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
