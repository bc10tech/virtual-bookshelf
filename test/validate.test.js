import test from 'node:test';
import assert from 'node:assert/strict';

import { validateProfile } from '../server/validate.js';
import { MAX } from '../server/limits.js';

test('corpo que nao e objeto, ou vazio, reprova com mensagem de formulario', () => {
  for (const body of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(validateProfile(body), { ok: false, error: 'corpo deve ser um objeto' });
  }
  assert.deepEqual(validateProfile({}), { ok: false, error: 'nada para atualizar' });
  // Chave desconhecida e descartada (strip) — e se so ela vier, nao sobra nada.
  assert.deepEqual(validateProfile({ role: 'admin' }), { ok: false, error: 'nada para atualizar' });
});

test('apelido: aparado, limitado; vazio vira null; null e aceito', () => {
  assert.deepEqual(validateProfile({ nickname: '  Bruno ' }), { ok: true, value: { nickname: 'Bruno' } });
  assert.deepEqual(validateProfile({ nickname: '   ' }), { ok: true, value: { nickname: null } });
  assert.deepEqual(validateProfile({ nickname: '' }), { ok: true, value: { nickname: null } });
  assert.deepEqual(validateProfile({ nickname: null }), { ok: true, value: { nickname: null } });
  assert.equal(validateProfile({ nickname: 'x'.repeat(MAX.nickname) }).ok, true);
  const long = validateProfile({ nickname: 'x'.repeat(MAX.nickname + 1) });
  assert.equal(long.ok, false);
  assert.match(long.error, /^apelido/);
  assert.equal(validateProfile({ nickname: 7 }).ok, false);
});

test("genero: 'm', 'f' ou null; o resto reprova", () => {
  for (const gender of ['m', 'f', null]) {
    assert.deepEqual(validateProfile({ gender }), { ok: true, value: { gender } });
  }
  for (const gender of ['x', '', 'M', 0]) {
    const r = validateProfile({ gender });
    assert.equal(r.ok, false, String(gender));
    assert.match(r.error, /^genero/);
  }
});

test('handle: minusculas na entrada, regex, limite, reservado', () => {
  assert.deepEqual(validateProfile({ handle: ' Bruno-Cesar ' }), { ok: true, value: { handle: 'bruno-cesar' } });
  assert.deepEqual(validateProfile({ handle: 'b' }), { ok: true, value: { handle: 'b' } });
  for (const handle of ['-bruno', 'bruno-', 'bru no', 'brúno', '', 'a'.repeat(MAX.handle + 1), null]) {
    const r = validateProfile({ handle });
    assert.equal(r.ok, false, String(handle));
    assert.match(r.error, /^handle/);
  }
  const reserved = validateProfile({ handle: 'ME' });
  assert.equal(reserved.ok, false);
  assert.match(reserved.error, /reservado/);
});

test('so as chaves presentes voltam (o $set tem de ser exatamente elas)', () => {
  const r = validateProfile({ nickname: 'Bia', gender: 'f', role: 'admin', email: 'x@y.z' });
  assert.deepEqual(r, { ok: true, value: { nickname: 'Bia', gender: 'f' } });
  assert.deepEqual(Object.keys(validateProfile({ handle: 'bia' }).value), ['handle']);
});
