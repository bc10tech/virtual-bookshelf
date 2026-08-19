import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEmail, handleFromEmail, handleWithSuffix } from '../server/identity.js';
import { MAX, HANDLE_RE } from '../server/limits.js';

test('normalizeEmail apara e poe em minusculas', () => {
  assert.equal(normalizeEmail('  Ana.Maria@Gmail.COM '), 'ana.maria@gmail.com');
  assert.equal(normalizeEmail(null), '');
});

test('handle da parte local: ponto vira hifen', () => {
  assert.equal(handleFromEmail('bcesar97.bc@gmail.com'), 'bcesar97-bc');
});

test('maiusculas, "+" e runs de simbolos viram um hifen so', () => {
  assert.equal(handleFromEmail('Ana.Maria+x@x.com'), 'ana-maria-x');
  assert.equal(handleFromEmail('a__b--c@x.com'), 'a-b-c');
});

test('diacriticos caem', () => {
  assert.equal(handleFromEmail('josé.ñandú@x.com'), 'jose-nandu');
});

test('hifens nas pontas somem; vazio cai no fallback', () => {
  assert.equal(handleFromEmail('-a-@x.com'), 'a');
  assert.equal(handleFromEmail('___@x.com'), 'leitor');
  assert.equal(handleFromEmail(''), 'leitor');
});

test('cabe em MAX.handle e nunca termina em hifen', () => {
  const long = `${'a'.repeat(MAX.handle - 1)}-bcdef@x.com`;
  const h = handleFromEmail(long);
  assert.ok(h.length <= MAX.handle);
  assert.ok(!h.endsWith('-'));
  assert.match(h, HANDLE_RE);
});

test('sufixo: n=1 e o proprio, n=2 e "-2", e a base encolhe para caber', () => {
  assert.equal(handleWithSuffix('bcesar97-bc', 1), 'bcesar97-bc');
  assert.equal(handleWithSuffix('bcesar97-bc', 2), 'bcesar97-bc-2');
  const base = 'a'.repeat(MAX.handle);
  const h = handleWithSuffix(base, 12);
  assert.equal(h.length, MAX.handle);
  assert.ok(h.endsWith('-12'));
  assert.match(h, HANDLE_RE);
});
