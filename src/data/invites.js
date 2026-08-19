import { request, json } from './api.js';

/** A allowlist, do lado do cliente. Todas as rotas exigem admin (403 senao). */

const BASE = '/api/v1/invites';

/** @returns {Promise<Array<{ email: string, invitedBy: string, createdAt: string, accepted: boolean }>>} */
export const list = () => request(BASE).then((body) => body?.items ?? []);

export const invite = (email) => request(BASE, json({ email }));

export const revoke = (email) =>
  request(`${BASE}/${encodeURIComponent(email)}`, { method: 'DELETE' });
