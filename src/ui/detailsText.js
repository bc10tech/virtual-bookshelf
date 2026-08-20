/**
 * Frases do cartao de detalhes, em pt-BR minusculo — o cartao e a "pagina do
 * livro", nao um rotulo de interface. Funcoes puras e sem imports de
 * proposito, no molde de `splashTitle.js` (`test/detailsText.test.js`).
 *
 * O parse de `yyyy-mm-dd` e por split manual: `new Date('yyyy-mm-dd')`
 * interpreta a string como UTC e num fuso negativo o dia 01/03 viraria 28/02.
 * `Date.UTC` entra so para a diferenca de dias, onde o fuso nao alcanca.
 */

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const MS_DIA = 86400000;

/** `'2026-03-01'` -> `{ y: 2026, m: 3, d: 1 }`; null para o que nao parseia. */
function parseIso(iso) {
  if (typeof iso !== 'string') return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

const mesDe = ({ m, y }) => `${MESES[m - 1]} de ${y}`;

/**
 * Frase do periodo de leitura.
 *
 *   periodText('2026-03-01', '2026-03-12', '2026-08-20')
 *   -> 'lido em 12 dias, em março'
 *
 * @param {string|null|undefined} startDate  yyyy-mm-dd
 * @param {string|null|undefined} endDate    yyyy-mm-dd; null = lendo agora
 * @param {string} todayIso  yyyy-mm-dd de hoje — injetado para a funcao ser
 *   deterministica; decide quando o ano e redundante e pode ser omitido
 * @returns {string}
 */
export function periodText(startDate, endDate, todayIso) {
  const ini = parseIso(startDate);
  const anoAtual = parseIso(todayIso)?.y;
  if (!ini) return 'Sem datas';

  if (!parseIso(endDate)) {
    const ano = ini.y === anoAtual ? '' : ` de ${ini.y}`;
    return `lendo desde ${ini.d} de ${MESES[ini.m - 1]}${ano}`;
  }

  const fim = parseIso(endDate);
  // Contagem inclusiva (comecou e terminou no mesmo dia = 1 dia), e nunca
  // negativa: dado ruim legado nao pode virar "lido em -3 dias".
  const dias = Math.max(
    1,
    Math.round(
      (Date.UTC(fim.y, fim.m - 1, fim.d) - Date.UTC(ini.y, ini.m - 1, ini.d)) / MS_DIA,
    ) + 1,
  );
  const duracao = dias === 1 ? 'lido num dia' : `lido em ${dias} dias`;

  if (ini.y !== fim.y) return `${duracao}, de ${mesDe(ini)} a ${mesDe(fim)}`;

  const ano = ini.y === anoAtual ? '' : ` de ${ini.y}`;
  if (ini.m !== fim.m) {
    return `${duracao}, de ${MESES[ini.m - 1]} a ${MESES[fim.m - 1]}${ano}`;
  }
  return `${duracao}, em ${MESES[ini.m - 1]}${ano}`;
}

/**
 * @param {number|null|undefined} pages
 * @returns {string|null}  '234 páginas' | null quando nao ha contagem
 */
export function pagesText(pages) {
  if (!pages) return null;
  return pages === 1 ? '1 página' : `${pages} páginas`;
}
