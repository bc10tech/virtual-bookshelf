import test from 'node:test';
import assert from 'node:assert/strict';

import { periodText, pagesText } from '../src/ui/detailsText.js';

const HOJE = '2026-08-20';

test('sem startDate cai no fallback', () => {
  for (const start of [null, undefined, '', 'lixo']) {
    assert.equal(periodText(start, '2026-03-12', HOJE), 'Sem datas');
  }
});

test('lido num dia', () => {
  assert.equal(periodText('2026-03-05', '2026-03-05', HOJE), 'lido num dia, em março');
});

test('lido no mesmo mes do ano atual omite o ano', () => {
  assert.equal(periodText('2026-03-01', '2026-03-12', HOJE), 'lido em 12 dias, em março');
});

test('lido no mesmo mes de outro ano carrega o ano', () => {
  assert.equal(
    periodText('2025-03-01', '2025-03-12', HOJE),
    'lido em 12 dias, em março de 2025',
  );
});

test('meses diferentes no ano atual', () => {
  assert.equal(
    periodText('2026-03-01', '2026-04-12', HOJE),
    'lido em 43 dias, de março a abril',
  );
});

test('meses diferentes em outro ano', () => {
  assert.equal(
    periodText('2025-03-01', '2025-04-12', HOJE),
    'lido em 43 dias, de março a abril de 2025',
  );
});

test('anos diferentes carregam os dois anos', () => {
  assert.equal(
    periodText('2025-12-01', '2026-02-01', HOJE),
    'lido em 63 dias, de dezembro de 2025 a fevereiro de 2026',
  );
});

test('lendo agora no ano atual', () => {
  assert.equal(periodText('2026-08-03', null, HOJE), 'lendo desde 3 de agosto');
});

test('lendo agora desde outro ano', () => {
  assert.equal(
    periodText('2025-12-28', null, HOJE),
    'lendo desde 28 de dezembro de 2025',
  );
});

test('fim antes do inicio nunca vira frase negativa', () => {
  assert.equal(periodText('2026-03-12', '2026-03-01', HOJE), 'lido num dia, em março');
});

test('dia 01 nao escorrega de mes por fuso horario', () => {
  // `new Date('2026-03-01')` em fuso negativo seria 28/02; o split manual nao.
  assert.match(periodText('2026-03-01', '2026-03-01', HOJE), /em março/);
  assert.match(periodText('2026-03-01', null, HOJE), /1 de março/);
});

test('pagesText', () => {
  assert.equal(pagesText(null), null);
  assert.equal(pagesText(undefined), null);
  assert.equal(pagesText(0), null);
  assert.equal(pagesText(1), '1 página');
  assert.equal(pagesText(234), '234 páginas');
});
