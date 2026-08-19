import test from 'node:test';
import assert from 'node:assert/strict';

import { googleAuthUrl, decodeIdToken, verifyClaims } from '../server/oidc.js';

const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const NOW = 1_700_000_000_000;

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Um JWT de mentira: header + payload validos, assinatura qualquer. */
const fakeJwt = (payload) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.assinatura`;

const goodPayload = () => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: Math.floor(NOW / 1000) + 3600,
  sub: '10769150350006150715113082367',
  email: 'Bruno@Gmail.com',
  email_verified: true,
  name: 'Bruno',
  picture: 'https://lh3.googleusercontent.com/a/x',
});

test('googleAuthUrl monta os parametros esperados', () => {
  const url = new URL(
    googleAuthUrl({
      clientId: CLIENT_ID,
      redirectUri: 'http://localhost:5173/auth/google/callback',
      state: 'abc',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/auth/google/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('state'), 'abc');
});

test('decodeIdToken abre o payload e devolve null para lixo', () => {
  assert.deepEqual(decodeIdToken(fakeJwt({ a: 1 })), { a: 1 });
  assert.equal(decodeIdToken('so.duas'), null);
  assert.equal(decodeIdToken('a.b.c'), null);
  assert.equal(decodeIdToken(`x.${b64([1, 2])}.y`), null);
  assert.equal(decodeIdToken(undefined), null);
});

test('claims validas: e-mail normalizado, name e picture extraidos', () => {
  const r = verifyClaims(goodPayload(), { clientId: CLIENT_ID, now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.claims, {
    sub: '10769150350006150715113082367',
    email: 'bruno@gmail.com',
    name: 'Bruno',
    picture: 'https://lh3.googleusercontent.com/a/x',
  });
});

test('as duas formas de iss do Google passam', () => {
  const p = { ...goodPayload(), iss: 'accounts.google.com' };
  assert.equal(verifyClaims(p, { clientId: CLIENT_ID, now: NOW }).ok, true);
});

test('iss estranho, aud de outro app, expirado, nao verificado, sem sub: reprovam', () => {
  const cases = [
    { ...goodPayload(), iss: 'https://evil.example' },
    { ...goodPayload(), aud: 'outro' },
    { ...goodPayload(), exp: Math.floor(NOW / 1000) - 120 },
    { ...goodPayload(), email_verified: false },
    { ...goodPayload(), email_verified: 'true' },
    { ...goodPayload(), sub: undefined },
    { ...goodPayload(), email: '' },
    null,
  ];
  for (const p of cases) {
    const r = verifyClaims(p, { clientId: CLIENT_ID, now: NOW });
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.equal(typeof r.error, 'string');
  }
});

test('tolerancia de relogio: expirado ha 30 s ainda passa com skew de 60 s', () => {
  const p = { ...goodPayload(), exp: Math.floor(NOW / 1000) - 30 };
  assert.equal(verifyClaims(p, { clientId: CLIENT_ID, now: NOW }).ok, true);
});

test('name ausente vira "", picture ausente vira null', () => {
  const p = goodPayload();
  delete p.name;
  delete p.picture;
  const r = verifyClaims(p, { clientId: CLIENT_ID, now: NOW });
  assert.equal(r.claims.name, '');
  assert.equal(r.claims.picture, null);
});
