import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCookies } from '../server/cookies.js';

test('cabecalho ausente ou vazio vira objeto vazio', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
});

test('varios pares, com espacos e percent-encoding', () => {
  assert.deepEqual(parseCookies('a=1; b=2%20x;c=3'), { a: '1', b: '2 x', c: '3' });
});

test('par sem "=" e ignorado; nome duplicado, o primeiro vence', () => {
  assert.deepEqual(parseCookies('lixo; vb.sid=abc; vb.sid=def'), { 'vb.sid': 'abc' });
});

test('valor com "=" dentro e preservado inteiro', () => {
  assert.deepEqual(parseCookies('t=a=b=c'), { t: 'a=b=c' });
});

test('percent-encoding invalido nao derruba: fica cru', () => {
  assert.deepEqual(parseCookies('x=%E0%A4%A'), { x: '%E0%A4%A' });
});

test('valor entre aspas perde as aspas', () => {
  assert.deepEqual(parseCookies('q="abc"'), { q: 'abc' });
});
