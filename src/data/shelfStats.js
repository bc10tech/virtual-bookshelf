/**
 * Agregados da estante para o dialogo de Estatisticas. Folha pura e sem
 * imports de proposito, no molde de `server/stats.js` (o resumo por pessoa da
 * lista de Amigos) — mesmo criterio de "lendo agora", mesma comparacao de ano
 * por prefixo da string ISO, testavel por `node --test`
 * (`test/shelfStats.test.js`).
 *
 * As datas sao lidas por split manual, nunca `new Date('yyyy-mm-dd')` (UTC
 * escorregaria de dia num fuso negativo); a duracao e a mesma contagem
 * INCLUSIVA do cartao de detalhes (`detailsText.js`): comecou e terminou no
 * mesmo dia = 1 dia, e nunca negativa.
 */

const MS_DIA = 86400000;

/** A mesma regra do cartao e da lista de Amigos. */
const isReading = (row) => Boolean(row.startDate && !row.endDate);

const parseIso = (iso) => {
  if (typeof iso !== 'string') return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
};

const daysBetween = (ini, fim) =>
  Math.max(1, Math.round((Date.UTC(fim.y, fim.m - 1, fim.d) - Date.UTC(ini.y, ini.m - 1, ini.d)) / MS_DIA) + 1);

/**
 * @param {Array<object>} records  o acervo completo da estante a vista
 * @returns {{
 *   total: number,
 *   finished: number,
 *   reading: number,
 *   pagesRead: number,
 *   avgRating: number|null,
 *   ratedCount: number,
 *   avgDays: number|null,
 *   years: Array<{ year: number, finished: number, pages: number, byMonth: number[] }>,
 * }}
 *   `pagesRead` soma so os terminados (sem contagem = 0). `avgRating` e a
 *   media dos registros com nota (`rating > 0`; 0 e "sem nota"), arredondada
 *   a 1 casa — e o que `formatRating` sabe mostrar. `avgDays` e a media
 *   arredondada da duracao dos terminados COM data de inicio. `years` vem do
 *   ano do `endDate`, mais recente primeiro; `byMonth` e indexado 0..11.
 */
export function shelfStats(records) {
  let finished = 0;
  let reading = 0;
  let pagesRead = 0;
  let ratingSum = 0;
  let ratedCount = 0;
  let daysSum = 0;
  let daysCount = 0;
  const byYear = new Map();

  for (const rec of records) {
    if (isReading(rec)) reading += 1;
    if (rec.rating > 0) {
      ratingSum += rec.rating;
      ratedCount += 1;
    }

    const fim = parseIso(rec.endDate);
    if (!fim) continue;

    finished += 1;
    pagesRead += rec.pages || 0;

    const ini = parseIso(rec.startDate);
    if (ini) {
      daysSum += daysBetween(ini, fim);
      daysCount += 1;
    }

    let year = byYear.get(fim.y);
    if (!year) {
      year = { year: fim.y, finished: 0, pages: 0, byMonth: Array(12).fill(0) };
      byYear.set(fim.y, year);
    }
    year.finished += 1;
    year.pages += rec.pages || 0;
    year.byMonth[fim.m - 1] += 1;
  }

  return {
    total: records.length,
    finished,
    reading,
    pagesRead,
    avgRating: ratedCount ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
    ratedCount,
    avgDays: daysCount ? Math.round(daysSum / daysCount) : null,
    years: [...byYear.values()].sort((a, b) => b.year - a.year),
  };
}
