import express from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { connect, close } from './db.js';
import { router as booksRouter } from './books.js';

const PORT = Number(process.env.PORT) || 3000;
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const app = express();
app.disable('x-powered-by');

// Um documento de livro completo nao chega perto disso; o teto so existe para
// que um corpo gigante nao ocupe memoria antes da validacao.
app.use(express.json({ limit: '16kb' }));

// O health check fica FORA da versao de proposito: ele e endpoint de operacao
// (uptime check), nao contrato de dados. Versiona-lo so criaria uma segunda URL
// para o monitoramento acompanhar a cada versao nova.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Tudo que devolve dado nasce versionado, antes de existir cliente publicado:
// depois disso, mudar formato de resposta quebra quem ja instalou.
app.use('/api/v1/books', booksRouter);

// Em desenvolvimento quem serve o front e o Vite (que faz proxy de /api para
// ca). Depois de `npm run build`, este mesmo processo serve o dist/ sozinho.
if (existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(`${DIST}/index.html`));
}

app.use((_req, res) => res.status(404).json({ error: 'rota nao encontrada' }));

// eslint-disable-next-line no-unused-vars -- o Express so reconhece o handler de
// erro pela aridade 4, entao `next` precisa existir mesmo sem uso.
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'erro interno' });
});

try {
  await connect();
  console.log('[api] mongodb conectado');
} catch (err) {
  console.error(
    '\n[api] nao consegui conectar no MongoDB.\n' +
      '      Abra o Docker Desktop e rode:  docker compose up -d\n' +
      `      Detalhe: ${err.message}\n`,
  );
  process.exit(1);
}

const server = app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => close().then(() => process.exit(0)));
  });
}
