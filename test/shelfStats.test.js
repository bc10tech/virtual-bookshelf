import test from 'node:test';
import assert from 'node:assert/strict';

import { shelfStats } from '../src/data/shelfStats.js';

const row = (over = {}) => ({
  title: 'Livro',
  pages: 100,
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  rating: 0,
  ...over,
});

test('estante vazia: zeros e medias nulas', () => {
  assert.deepEqual(shelfStats([]), {
    total: 0,
    finished: 0,
    reading: 0,
    pagesRead: 0,
    avgRating: null,
    ratedCount: 0,
    avgDays: null,
    years: [],
  });
});

test('lendo agora nao conta como terminado nem soma paginas', () => {
  const s = shelfStats([row({ endDate: null, pages: 500 })]);
  assert.equal(s.total, 1);
  assert.equal(s.reading, 1);
  assert.equal(s.finished, 0);
  assert.equal(s.pagesRead, 0);
  assert.deepEqual(s.years, []);
});

test('paginas: soma so dos terminados, e null conta zero', () => {
  const s = shelfStats([
    row({ pages: 200 }),
    row({ pages: null }),
    row({ pages: 300, endDate: null }),
  ]);
  assert.equal(s.finished, 2);
  assert.equal(s.pagesRead, 200);
});

test('nota media: rating 0 e "sem nota", nao entra; media a 1 casa', () => {
  const s = shelfStats([
    row({ rating: 4 }),
    row({ rating: 3 }),
    row({ rating: 0 }),
    row({ rating: 3.5, endDate: null }), // lendo tambem conta, se tem nota
  ]);
  assert.equal(s.ratedCount, 3);
  assert.equal(s.avgRating, 3.5);
});

test('nota media arredonda a 1 casa', () => {
  const s = shelfStats([row({ rating: 4 }), row({ rating: 3 }), row({ rating: 3 })]);
  assert.equal(s.avgRating, 3.3);
});

test('tempo medio: duracao inclusiva, media arredondada', () => {
  const s = shelfStats([
    row({ startDate: '2026-01-01', endDate: '2026-01-10' }), // 10 dias
    row({ startDate: '2026-02-01', endDate: '2026-02-01' }), // 1 dia
  ]);
  assert.equal(s.avgDays, 6); // (10 + 1) / 2 = 5.5 -> 6
});

test('terminado sem inicio nao entra no tempo medio, mas conta no resto', () => {
  const s = shelfStats([row({ startDate: null })]);
  assert.equal(s.finished, 1);
  assert.equal(s.avgDays, null);
});

test('fim antes do inicio clampa em 1 dia', () => {
  const s = shelfStats([row({ startDate: '2026-01-10', endDate: '2026-01-01' })]);
  assert.equal(s.avgDays, 1);
});

test('anos: agrupa pelo endDate, mais recente primeiro, meses indexados', () => {
  const s = shelfStats([
    row({ endDate: '2025-12-05', pages: 50 }),
    row({ endDate: '2026-03-10', pages: 200 }),
    row({ endDate: '2026-03-20', pages: null }),
    row({ endDate: '2026-08-01', pages: 100 }),
  ]);
  assert.equal(s.years.length, 2);
  assert.equal(s.years[0].year, 2026);
  assert.equal(s.years[0].finished, 3);
  assert.equal(s.years[0].pages, 300);
  assert.equal(s.years[0].byMonth[2], 2); // marco
  assert.equal(s.years[0].byMonth[7], 1); // agosto
  assert.equal(s.years[1].year, 2025);
  assert.equal(s.years[1].byMonth[11], 1); // dezembro
});

test('dia 01 nao escorrega de mes/ano por fuso horario', () => {
  const s = shelfStats([row({ endDate: '2026-01-01' })]);
  assert.equal(s.years[0].year, 2026);
  assert.equal(s.years[0].byMonth[0], 1);
});
