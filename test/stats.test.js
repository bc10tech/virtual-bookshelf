import test from 'node:test';
import assert from 'node:assert/strict';

import { shelfStats } from '../server/stats.js';

const row = (userId, order, startDate, endDate, title = `livro ${order}`) => ({
  userId,
  order,
  startDate,
  endDate,
  title,
});

test('conta total e terminados no ano, por pessoa', () => {
  const stats = shelfStats(
    [
      row('a', 1, '2025-12-01', '2026-01-10'),
      row('a', 2, '2026-02-01', '2026-02-20'),
      row('a', 3, '2025-03-01', '2025-04-01'),
      row('b', 1, '2026-05-05', '2026-05-09'),
    ],
    2026,
  );
  assert.deepEqual(stats.get('a'), { total: 3, readThisYear: 2, reading: null });
  assert.deepEqual(stats.get('b'), { total: 1, readThisYear: 1, reading: null });
});

test('lendo agora = comecou e nao terminou; sem candidato fica null', () => {
  const stats = shelfStats([row('a', 1, '2026-01-01', null, 'Grande Sertao')], 2026);
  assert.deepEqual(stats.get('a').reading, { title: 'Grande Sertao' });
  assert.equal(shelfStats([row('a', 1, null, null)], 2026).get('a').reading, null);
  assert.equal(shelfStats([row('a', 1, '2026-01-01', '2026-01-02')], 2026).get('a').reading, null);
});

test('varios em leitura: ganha o que comecou por ultimo, desempate pelo order', () => {
  const rows = [
    row('a', 5, '2026-03-01', null, 'antigo'),
    row('a', 2, '2026-06-01', null, 'recente, cadastrado antes'),
    row('a', 9, '2026-06-01', null, 'recente, cadastrado depois'),
  ];
  assert.equal(shelfStats(rows, 2026).get('a').reading.title, 'recente, cadastrado depois');
  // A ordem das linhas nao muda o resultado.
  assert.equal(shelfStats([...rows].reverse(), 2026).get('a').reading.title, 'recente, cadastrado depois');
});

test('sem linhas, sem entradas', () => {
  assert.equal(shelfStats([], 2026).size, 0);
});
