import test from 'node:test';
import assert from 'node:assert/strict';

import { bootParams } from '../src/bootParams.js';

test('URL limpa: nada', () => {
  assert.deepEqual(bootParams(''), { auth: null, welcome: null, owner: null });
  assert.deepEqual(bootParams(undefined), { auth: null, welcome: null, owner: null });
});

test('?welcome=1&nome= vira a sugestao de apelido (aparada e limitada)', () => {
  assert.deepEqual(bootParams('?welcome=1&nome=Bruno').welcome, { name: 'Bruno' });
  assert.deepEqual(bootParams('?welcome=1&nome=%20Jo%C3%A3o%20').welcome, { name: 'João' });
  assert.deepEqual(bootParams('?welcome=1').welcome, { name: '' });
  assert.equal(bootParams('?welcome=1&nome=' + 'x'.repeat(80)).welcome.name.length, 40);
  assert.equal(bootParams('?welcome=0&nome=Bruno').welcome, null);
  assert.equal(bootParams('?nome=Bruno').welcome, null);
});

test('?u= e saneado: minusculas, sem lixo; o servidor decide se existe', () => {
  assert.equal(bootParams('?u=Bruno-Cesar').owner, 'bruno-cesar');
  assert.equal(bootParams('?u=%20ana%20').owner, 'ana');
  assert.equal(bootParams('?u=').owner, null);
  assert.equal(bootParams('?u=a%20b').owner, null);
  assert.equal(bootParams('?u=../x').owner, null);
  assert.equal(bootParams('?u=' + 'a'.repeat(33)).owner, null);
});

test('os tres convivem, e o auth continua o de gate.js', () => {
  const p = bootParams('?auth=cancelado&u=ana&welcome=1&nome=Bia');
  assert.deepEqual(p, {
    auth: { reason: 'cancelado', email: null },
    welcome: { name: 'Bia' },
    owner: 'ana',
  });
});
