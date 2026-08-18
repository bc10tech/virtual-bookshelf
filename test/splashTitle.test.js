import test from 'node:test';
import assert from 'node:assert/strict';

import { splashTitle } from '../src/ui/splashTitle.js';

const join = (parts) => parts.map((p) => p.text).join('');

test('sem usuario: um segmento, sem acento', () => {
  for (const user of [null, undefined, {}]) {
    const parts = splashTitle(user);
    assert.deepEqual(parts, [{ text: 'Estante Virtual', accent: false }]);
  }
});

test('apelido vazio ou so espacos cai no titulo generico', () => {
  for (const nickname of ['', '   ', '\t\n']) {
    assert.equal(join(splashTitle({ nickname, gender: 'm' })), 'Estante Virtual');
    assert.equal(splashTitle({ nickname }).length, 1);
  }
});

test("gender 'm' usa 'do'", () => {
  assert.equal(
    join(splashTitle({ nickname: 'Bruno', gender: 'm' })),
    'Estante Virtual do Bruno',
  );
});

test("gender 'f' usa 'da'", () => {
  assert.equal(
    join(splashTitle({ nickname: 'Ana', gender: 'f' })),
    'Estante Virtual da Ana',
  );
});

test('gender ausente, nulo ou desconhecido usa "de"', () => {
  for (const gender of [undefined, null, 'x', '']) {
    assert.equal(
      join(splashTitle({ nickname: 'Alex', gender })),
      'Estante Virtual de Alex',
    );
  }
});

test('o acento fica so no sufixo, e o espaco no fim do primeiro segmento', () => {
  const parts = splashTitle({ nickname: 'Bruno', gender: 'm' });
  assert.deepEqual(parts, [
    { text: 'Estante Virtual ', accent: false },
    { text: 'do Bruno', accent: true },
  ]);
});

test('apelido com espacos nas pontas e aparado', () => {
  assert.equal(
    join(splashTitle({ nickname: '  Bruno  ', gender: 'm' })),
    'Estante Virtual do Bruno',
  );
});
