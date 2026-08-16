/**
 * Validacao escrita a mao. Uma dependencia como zod nao pesaria no cliente
 * (e codigo de servidor), mas para um unico formato de documento sao 50 linhas
 * contra um pacote inteiro. O steps.md marca a troca para zod quando houver
 * mais rotas.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COVER_HOST = 'https://covers.openlibrary.org/';

const str = (v, max) => typeof v === 'string' && v.length <= max;
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Normaliza e valida o corpo de um livro.
 * @param {object} body
 * @param {{ partial?: boolean }} opts  partial=true para PATCH
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateBook(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'corpo deve ser um objeto' };
  }

  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const required = (k) => !partial || has(k);

  // --- titulo -------------------------------------------------------------
  if (required('title')) {
    const title = trimmed(body.title);
    if (!title || title.length > 300) {
      return { ok: false, error: 'title: obrigatorio, ate 300 caracteres' };
    }
    out.title = title;
  }

  // --- autor --------------------------------------------------------------
  if (has('author')) {
    if (!str(body.author ?? '', 300)) return { ok: false, error: 'author invalido' };
    out.author = trimmed(body.author);
  } else if (!partial) {
    out.author = '';
  }

  // --- paginas ------------------------------------------------------------
  if (has('pages')) {
    const p = body.pages;
    if (p !== null && (!Number.isInteger(p) || p < 1 || p > 5000)) {
      return { ok: false, error: 'pages: inteiro entre 1 e 5000, ou null' };
    }
    out.pages = p ?? null;
  } else if (!partial) {
    out.pages = null;
  }

  // --- capa ---------------------------------------------------------------
  if (has('coverUrl')) {
    const url = body.coverUrl;
    if (url !== null && url !== '') {
      // Allowlist de host: impede que o documento vire vetor para carregar
      // imagem de qualquer origem no cliente.
      if (!str(url, 400) || !url.startsWith(COVER_HOST)) {
        return { ok: false, error: 'coverUrl: apenas covers.openlibrary.org' };
      }
      out.coverUrl = url;
      out.coverSource = 'openlibrary';
    } else {
      out.coverUrl = null;
      out.coverSource = 'none';
    }
  } else if (!partial) {
    out.coverUrl = null;
    out.coverSource = 'none';
  }

  // --- referencias Open Library ------------------------------------------
  for (const k of ['olKey', 'isbn']) {
    if (has(k)) {
      if (body[k] !== null && !str(body[k], 100)) {
        return { ok: false, error: `${k} invalido` };
      }
      out[k] = body[k] ? trimmed(body[k]) : null;
    } else if (!partial) {
      out[k] = null;
    }
  }

  // --- datas --------------------------------------------------------------
  if (required('startDate')) {
    const d = body.startDate;
    if (typeof d !== 'string' || !DATE_RE.test(d) || Number.isNaN(Date.parse(d))) {
      return { ok: false, error: 'startDate: data ISO yyyy-mm-dd obrigatoria' };
    }
    out.startDate = d;
  }
  if (has('endDate')) {
    const d = body.endDate;
    if (d !== null && d !== '') {
      if (typeof d !== 'string' || !DATE_RE.test(d) || Number.isNaN(Date.parse(d))) {
        return { ok: false, error: 'endDate: data ISO yyyy-mm-dd ou null' };
      }
      out.endDate = d;
    } else {
      out.endDate = null;
    }
  } else if (!partial) {
    out.endDate = null;
  }

  const start = out.startDate ?? (partial ? null : undefined);
  if (start && out.endDate && out.endDate < start) {
    return { ok: false, error: 'endDate nao pode ser anterior a startDate' };
  }

  // --- nota ---------------------------------------------------------------
  if (has('rating')) {
    const r = body.rating;
    // Meio ponto e permitido (2.5, 3.5...). Notas inteiras ja gravadas
    // continuam validas, entao nao ha migracao a fazer.
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 5 || (r * 2) % 1 !== 0) {
      return { ok: false, error: 'rating: de 0 a 5, em passos de 0,5' };
    }
    out.rating = r;
  } else if (!partial) {
    out.rating = 0;
  }

  // --- review -------------------------------------------------------------
  if (has('review')) {
    if (!str(body.review ?? '', 2000)) {
      return { ok: false, error: 'review: ate 2000 caracteres' };
    }
    out.review = body.review ?? '';
  } else if (!partial) {
    out.review = '';
  }

  if (partial && Object.keys(out).length === 0) {
    return { ok: false, error: 'nada para atualizar' };
  }

  return { ok: true, value: out };
}

/** Ids sao gerados pelo cliente (uuid v4) ou pelo fallback base36. */
export const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
