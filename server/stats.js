/**
 * Resumo da estante de cada pessoa para a lista de amigos: quantos livros,
 * quantos terminados no ano, e o que esta lendo agora.
 *
 * Folha pura (zero imports) de proposito: a consulta que alimenta isto e um
 * `find` com projecao em `users.js`, e a reducao fica aqui para o `node --test`
 * alcancar. Com poucos usuarios e centenas de livros, reduzir no Node custa
 * menos que manter um `aggregate` que ninguem consegue testar sem banco.
 */

/** "Lendo agora": comecou e ainda nao terminou — a mesma regra do cliente. */
const isReading = (row) => Boolean(row.startDate && !row.endDate);

/**
 * @param {Array<{ userId: string, title: string, startDate: string|null,
 *                 endDate: string|null, order: number }>} rows
 * @param {number} year  ano corrente do servidor (o cliente escreve "N lidos em {year}")
 * @returns {Map<string, { total: number, readThisYear: number, reading: { title: string }|null }>}
 */
export function shelfStats(rows, year) {
  const prefix = `${year}-`;
  const out = new Map();
  // Candidato a "lendo agora" por pessoa, para o desempate nao depender da ordem
  // em que as linhas chegam: o que comecou por ultimo ganha; empate pelo `order`
  // (o cadastrado por ultimo).
  const current = new Map();

  for (const row of rows) {
    let s = out.get(row.userId);
    if (!s) {
      s = { total: 0, readThisYear: 0, reading: null };
      out.set(row.userId, s);
    }
    s.total++;
    if (typeof row.endDate === 'string' && row.endDate.startsWith(prefix)) s.readThisYear++;

    if (isReading(row)) {
      const best = current.get(row.userId);
      const wins =
        !best ||
        row.startDate > best.startDate ||
        (row.startDate === best.startDate && (row.order ?? 0) > (best.order ?? 0));
      if (wins) current.set(row.userId, row);
    }
  }

  for (const [userId, row] of current) out.get(userId).reading = { title: row.title };
  return out;
}
