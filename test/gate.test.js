import test from 'node:test';
import assert from 'node:assert/strict';

import { authFlagFromSearch } from '../src/ui/gate.js';

test('sem ?auth= nao ha aviso', () => {
  assert.equal(authFlagFromSearch(''), null);
  assert.equal(authFlagFromSearch('?u=bruno'), null);
  assert.equal(authFlagFromSearch(undefined), null);
});

test('nao-convidado carrega o e-mail, decodificado e em minusculas', () => {
  assert.deepEqual(authFlagFromSearch('?auth=nao-convidado&email=Ana%40Gmail.com'), {
    reason: 'nao-convidado',
    email: 'ana@gmail.com',
  });
});

test('cancelado e erro vem sem e-mail', () => {
  assert.deepEqual(authFlagFromSearch('?auth=cancelado'), { reason: 'cancelado', email: null });
  assert.deepEqual(authFlagFromSearch('?auth=erro'), { reason: 'erro', email: null });
});

test('motivo desconhecido e ignorado', () => {
  assert.equal(authFlagFromSearch('?auth=whatever'), null);
});
