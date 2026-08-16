/**
 * Limites do documento de livro, compartilhados pelas DUAS barreiras: a
 * validacao de entrada (`validate.js`, em zod) e a validacao do banco
 * (`schema.js`, em `$jsonSchema`). O arquivo existe para que elas nao possam
 * divergir — um numero mudado aqui muda as duas ao mesmo tempo.
 *
 * Numeros de servidor: nada aqui tem relacao com o `src/config.js` do cliente,
 * que descreve a cena. E folha pura, sem nenhum import, para poder ser lido
 * tanto pelo zod quanto por um script administrativo que nao carrega o Express.
 *
 * INVARIANTE DE DIRECAO — o unico que importa de verdade aqui:
 *
 *   o validador do banco so pode ser IGUAL OU MAIS FROUXO que o zod.
 *
 * Nunca mais estrito. Se o banco reprovar algo que a API aceitou, quem cadastra
 * um livro leva um erro opaco no lugar da mensagem do formulario, e a segunda
 * barreira — que existe para defender — vira a causa da queda. Duas assimetrias
 * reais entre os dois motores ja caem para o lado seguro, e precisam continuar
 * caindo:
 *
 *   - `maxLength` do MongoDB conta code points; o `.max()` do zod conta
 *     unidades UTF-16. Um titulo de 200 emojis mede 400 para o zod e 200 para o
 *     Mongo: o zod reprova primeiro, que e a ordem certa.
 *   - `pattern` do Mongo e PCRE, onde `$` casa tambem antes de um `\n` final;
 *     em JS, nao. Uma string terminada em `\n` passaria no banco e nao na API.
 */

export const MAX = {
  title: 300,
  author: 300,
  review: 2000,
  coverUrl: 400,
  reference: 100, // olKey e isbn seguem a mesma regra
};

export const PAGES = { min: 1, max: 5000 };

// Meio ponto e permitido (2.5, 3.5...). `0.5` e exato em binario, entao o
// `multipleOf` do `$jsonSchema` nao corre risco de ponto flutuante.
export const RATING = { min: 0, max: 5, step: 0.5 };

// Allowlist de host: impede que o documento vire vetor para carregar imagem de
// qualquer origem no cliente. Quando o proxy de capas entrar (ponto 5 do
// steps.md), e aqui que a lista afrouxa — e as duas barreiras afrouxam juntas.
export const COVER_HOST = 'https://covers.openlibrary.org/';

/**
 * O mesmo host em forma de ancora de regex, derivado do literal acima em vez de
 * reescrito: e o `pattern` que o `$jsonSchema` usa, e escrever a URL uma segunda
 * vez seria justamente a divergencia que este arquivo previne.
 */
export const COVER_HOST_RE = new RegExp(`^${COVER_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** Data de leitura: `yyyy-mm-dd`. O calendario em si so o zod consegue conferir. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ids vem do cliente (uuid v4 ou o fallback base36) ou do `crypto.randomUUID` do servidor. */
export const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * `createdAt` e `updatedAt` sao STRING ISO, nao BSON `Date` — quem as escreve e
 * `new Date().toISOString()` em `books.js`, e o formato dele e fixo.
 */
export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
