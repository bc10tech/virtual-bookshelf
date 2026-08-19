import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLayout, slotPosition, isReading, editionKey } from '../src/scene/layout.js';
import { BOOK } from '../src/config.js';

const rec = (id, extra = {}) => ({
  _id: id,
  title: 'Dom Casmurro',
  author: 'Machado de Assis',
  olKey: '/works/OL1W',
  pages: 300,
  startDate: '2026-01-10',
  endDate: '2026-02-01',
  ...extra,
});

test('isReading: comecou e nao terminou', () => {
  assert.equal(isReading(rec('a')), false);
  assert.equal(isReading(rec('a', { endDate: null })), true);
  assert.equal(isReading(rec('a', { startDate: null, endDate: null })), false);
});

test('o Placement carrega `reading`', () => {
  const { placements } = computeLayout([rec('a'), rec('b', { endDate: null })]);
  assert.equal(placements.get('a').reading, false);
  assert.equal(placements.get('b').reading, true);
});

test('livro em leitura fica puxado para a frente; os outros, alinhados', () => {
  const { placements } = computeLayout([rec('a'), rec('b', { endDate: null })]);
  const a = slotPosition(placements.get('a'));
  const b = slotPosition(placements.get('b'));
  // Mesma obra → mesma profundidade, entao a unica diferenca no z e o lift.
  assert.ok(Math.abs(b.z - a.z - BOOK.READING_LIFT_Z) < 1e-9);
  assert.ok(Math.abs(a.z - (BOOK.FRONT_Z - placements.get('a').depth / 2)) < 1e-9);
});

test('o lift de leitura e menor que o da selecao (a selecao ainda sobe por cima)', () => {
  assert.ok(BOOK.READING_LIFT_Z > 0);
  assert.ok(BOOK.READING_LIFT_Z < BOOK.SELECT_LIFT_Z);
});

test('dois exemplares da mesma obra sao geometricamente identicos', () => {
  const { placements } = computeLayout([rec('a'), rec('b')]);
  assert.equal(editionKey(rec('a')), editionKey(rec('b')));
  assert.equal(placements.get('a').height, placements.get('b').height);
  assert.equal(placements.get('a').depth, placements.get('b').depth);
});
