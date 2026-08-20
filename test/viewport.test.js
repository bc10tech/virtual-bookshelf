import test from 'node:test';
import assert from 'node:assert/strict';

import { keyboardInset } from '../src/ui/viewport.js';

test('teclado aberto: a diferenca de altura', () => {
  assert.equal(keyboardInset(900, 540, 0), 360);
});

test('teclado fechado: zero', () => {
  assert.equal(keyboardInset(900, 900, 0), 0);
});

test('iOS com pan: o offsetTop desconta do inset', () => {
  assert.equal(keyboardInset(900, 500, 60), 340);
});

test('nunca negativo', () => {
  assert.equal(keyboardInset(900, 920, 0), 0);
});

test('fracoes arredondam', () => {
  assert.equal(keyboardInset(900, 539.6, 0), 360);
});
