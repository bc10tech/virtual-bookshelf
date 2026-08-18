/**
 * Titulo da splash, em segmentos: o primeiro e sempre "Estante Virtual", o
 * segundo (quando ha usuario) e o sufixo personalizado, que sai na cor de
 * acento. Funcao pura e sem imports de proposito — e o unico pedaco da splash
 * que da para testar no Node (`test/splashTitle.test.js`).
 *
 *   splashTitle({ nickname: 'Bruno', gender: 'm' })
 *   -> [{ text: 'Estante Virtual ', accent: false }, { text: 'do Bruno', accent: true }]
 *
 * @param {{ nickname?: string, gender?: 'm'|'f'|null }|null|undefined} user
 * @returns {Array<{ text: string, accent: boolean }>}
 */
export function splashTitle(user) {
  const nick = user?.nickname?.trim();
  if (!nick) return [{ text: 'Estante Virtual', accent: false }];

  // Sem genero declarado o "de" serve para qualquer apelido.
  const prep = user.gender === 'm' ? 'do' : user.gender === 'f' ? 'da' : 'de';

  // O espaco fica no FIM do primeiro segmento: e nele que a linha quebra no
  // celular, e o sufixo inteiro desce junto.
  return [
    { text: 'Estante Virtual ', accent: false },
    { text: `${prep} ${nick}`, accent: true },
  ];
}
