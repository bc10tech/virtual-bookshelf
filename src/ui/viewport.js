/**
 * Quanto do viewport de layout o teclado virtual esta tomando, em px.
 *
 * `100dvh` NAO encolhe quando o teclado abre (iOS nunca redimensiona o layout
 * viewport; o Chrome moderno tambem nao, por padrao) — quem enxerga o teclado
 * e o `visualViewport`. A conta recebe numeros, nao os objetos do browser, de
 * proposito: e o unico pedaco testavel no Node (`test/viewport.test.js`).
 *
 * O `offsetTop` entra porque no iOS o browser "empurra" a pagina para manter o
 * campo focado a vista: o visual viewport desliza sem mudar de altura, e sem
 * esse termo o inset sairia maior que o teclado.
 */
export const keyboardInset = (innerHeight, vvHeight, vvOffsetTop) =>
  Math.max(0, Math.round(innerHeight - vvHeight - vvOffsetTop));
