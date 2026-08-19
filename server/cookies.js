/**
 * Leitura do cabecalho `Cookie`. So a leitura: quem ESCREVE cookie e o
 * `res.cookie()`/`res.clearCookie()` que o Express ja traz — o que ele nao traz
 * e o parse, e o `cookie-parser` seria uma dependencia para estas linhas.
 *
 * Folha pura (sem Express), para o `node --test` alcancar.
 */

/**
 * `'a=1; b=2%20x'` -> `{ a: '1', b: '2 x' }`. Par sem `=` e ignorado; nome
 * repetido, o primeiro vence (e o que o browser manda primeiro e o de path mais
 * especifico). Valor que nao decodifica fica cru em vez de derrubar o request.
 *
 * @param {string|undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    // Valor entre aspas e permitido pela RFC 6265; o browser nao manda, mas
    // curl manda quem copia de um `Set-Cookie`.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}
