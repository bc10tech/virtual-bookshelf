import { normalizeEmail } from './identity.js';

/**
 * As variaveis de ambiente do login, lidas UMA vez e num lugar so. Os outros
 * modulos importam daqui em vez de ler `process.env` — assim o default e a
 * normalizacao de cada uma nao tem como divergir entre `auth.js` e
 * `session.js`.
 *
 * `MONGODB_*` e `PORT` continuam onde estavam (`db.js`, `index.js`): sao de
 * outro assunto e ja tinham dono.
 */

/**
 * Onde o site e servido — e o que vai no redirect URI registrado no Google, por
 * isso a barra final e tirada: o Google compara a string inteira, e
 * `.../callback` != `...//callback`. Em desenvolvimento e o Vite (5173), que
 * faz proxy de `/auth` para ca.
 */
export const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');

export const REDIRECT_URI = `${BASE_URL}/auth/google/callback`;

/**
 * `Secure` derivado do proprio BASE_URL, nao de `NODE_ENV`: em `http://localhost`
 * o browser NAO grava cookie `Secure`, e o login pareceria funcionar (o redirect
 * volta) mas cairia no gate em seguida. Em https vira `Secure` sozinho.
 */
export const SECURE_COOKIES = BASE_URL.startsWith('https:');

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

export const oauthConfigured = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

/**
 * O unico e-mail que entra sem convite, e o que ganha `role: 'admin'`. O
 * fallback no codigo e deliberado (app pessoal): sem nada no `.env` o dono
 * continua entrando. Normalizado aqui para a comparacao no login ser sempre
 * minusculas contra minusculas.
 */
export const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || 'bcesar97.bc@gmail.com');
