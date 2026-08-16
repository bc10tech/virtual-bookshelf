import express from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { connect, close, isConnected, isLocal } from './db.js';
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
//
// `ok` responde "o processo esta vivo" e `db` responde "ele consegue servir
// dado" — duas perguntas diferentes, e por isso duas chaves. O status fica 200
// nas duas situacoes de proposito: um 503 aqui faria o orquestrador reiniciar o
// processo, que e exatamente a reacao errada quando quem esta fora e o banco.
app.get('/api/health', (_req, res) => res.json({ ok: true, db: isConnected() }));

// Guarda das rotas de dado. Quando o banco e remoto o boot nao aborta (ver
// abaixo), entao alguma requisicao pode chegar antes de existir conexao — sem
// isto, `books()` estouraria num 500 opaco. A tentativa de reconectar aqui e o
// que faz o processo se recuperar sozinho de um solucco do Atlas, sem reinicio.
app.use('/api/v1', async (_req, res, next) => {
  if (isConnected()) return next();
  try {
    await connect();
    console.log('[api] mongodb reconectado');
    next();
  } catch {
    res.status(503).json({ error: 'banco indisponivel' });
  }
});

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
  console.log(`[api] mongodb conectado (${isLocal ? 'container local' : 'remoto'})`);
} catch (err) {
  // No desenvolvimento a causa e quase sempre uma so, e morrer com a instrucao
  // na tela e melhor que um servidor de pe que erra em toda requisicao.
  if (isLocal) {
    console.error(
      '\n[api] nao consegui conectar no MongoDB.\n' +
        '      Abra o Docker Desktop e rode:  docker compose up -d\n' +
        `      Detalhe: ${err.message}\n`,
    );
    process.exit(1);
  }
  // Contra um banco gerenciado, o inverso: sair aqui transforma qualquer
  // indisponibilidade momentanea em crashloop — o processo morre, o orquestrador
  // reergue, o banco ainda nao voltou, repete. Subir e responder 503 nas rotas
  // de dado (o guarda la em cima) se recupera sozinho quando o banco volta.
  console.error(`[api] mongodb indisponivel no boot: ${err.message}`);
  console.error('[api] subindo mesmo assim — /api/health responde e as rotas de dado dao 503.');
}

const server = app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => close().then(() => process.exit(0)));
  });
}
