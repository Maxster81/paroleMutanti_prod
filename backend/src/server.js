/**
 * server.js — Entry point del backend "Parole Mutanti"
 *
 * Avvia Express (HTTP + static frontend) + Socket.io (WebSocket).
 * Espone endpoint /health per monitoring.
 *
 * Uso: node backend/src/server.js
 *
 * @module backend/src/server
 */

import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { logger } from './logger.js';
import { healthCheck as dbHealthCheck } from './db/wordQueries.js';
import { closePool } from './db/pool.js';
import { attachSocketHandlers } from './sockets/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND_DIR = join(__dirname, '..', '..', 'frontend');

// ============================================================
// Express app
// ============================================================
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  maxHttpBufferSize: 100 * 1024, // 100KB max payload (regola .clinerules/05-security)
  cors: {
    origin: config.security.corsOrigin,
    methods: ['GET', 'POST'],
  },
});

// ============================================================
// Middleware
// ============================================================
app.use(express.json({ limit: '100kb' }));

// Request logging (semplice)
app.use((req, res, next) => {
  const inizio = Date.now();
  res.on('finish', () => {
    const durata = Date.now() - inizio;
    logger.info('http_request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durataMs: durata,
    });
  });
  next();
});

// ============================================================
// Routes HTTP
// ============================================================

/**
 * Health check endpoint.
 * Ritorna stato app + DB + uptime + versione.
 */
app.get('/health', async (req, res) => {
  const dbCheck = await dbHealthCheck();
  const stato = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    version: '0.1.0',
    database: dbCheck.ok ? 'ok' : 'error',
    database_error: dbCheck.errore,
    partite_attive: io.engine.clientsCount > 0 ? 'clients_connected' : 'no_clients',
    env: config.nodeEnv,
  };
  res.status(dbCheck.ok ? 200 : 503).json(stato);
});

/**
 * Root endpoint: serve index.html del frontend (SPA).
 */
app.get('/', (req, res) => {
  const indexPath = join(FRONTEND_DIR, 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="it">
        <head>
          <title>Parole Mutanti — API</title>
          <meta charset="UTF-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #1a1a2e; color: #eee; }
            h1 { color: #16c79a; }
            code { background: #0f3460; padding: 2px 6px; border-radius: 3px; }
            a { color: #16c79a; }
          </style>
        </head>
        <body>
          <h1>🎮 Parole Mutanti — Backend</h1>
          <p>Il backend è in esecuzione. Il frontend (interfaccia web) non è ancora stato creato — arriverà in M4.</p>
          <p>Endpoint disponibili:</p>
          <ul>
            <li><code>GET /health</code> — stato del servizio</li>
            <li><code>GET /</code> — questa pagina</li>
            <li><code>WebSocket</code> — eventi di gioco (vedi <code>backend/src/sockets/</code>)</li>
          </ul>
          <p><a href="/health">→ /health</a></p>
        </body>
      </html>
    `);
  }
});

// Servi file statici del frontend (CSS, JS) se esistono
app.use(express.static(FRONTEND_DIR));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, errore: 'non_trovato', path: req.path });
});

// Error handler globale
app.use((err, req, res, next) => {
  logger.error('express_error', { errore: err.message, stack: err.stack });
  res.status(500).json({ ok: false, errore: 'errore_interno' });
});

// ============================================================
// Socket.io
// ============================================================
attachSocketHandlers(io);

// ============================================================
// Avvio server
// ============================================================
server.listen(config.port, config.host, () => {
  logger.info('server_avviato', {
    porta: config.port,
    host: config.host,
    env: config.nodeEnv,
    url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
  });
});

// ============================================================
// Graceful shutdown
// ============================================================
async function shutdown(signal) {
  logger.info('shutdown_iniziato', { signal });
  io.close();
  server.close();
  try {
    await closePool();
  } catch (err) {
    logger.error('errore_chiusura_pool', { errore: err.message });
  }
  logger.info('shutdown_completato');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server, io };
