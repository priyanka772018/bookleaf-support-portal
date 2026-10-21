import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/env.js';
import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import ticketRoutes from './routes/tickets.js';
import adminRoutes from './routes/admin.js';
import eventRoutes from './routes/events.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { aiHealth } from './services/aiService.js';
import { query } from './db/pool.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  app.use(express.json({ limit: '100kb' }));
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));

  app.get('/api/health', async (_req, res) => {
    let db = 'ok';
    try { await query('SELECT 1'); } catch { db = 'down'; }
    res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, ai: aiHealth() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/books', bookRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/events', eventRoutes);

  // OpenAPI spec (rendered at /api/docs).
  const docsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs');
  app.get('/api/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(path.join(docsDir, 'openapi.yaml')));
  app.get('/api/docs', (_req, res) => res.type('html').send(`<!doctype html><html><head><title>BookLeaf API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/openapi.yaml', dom_id: '#ui' });</script></body></html>`));

  app.use('/api', notFoundHandler);

  // In production the same service serves the built React app.
  const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
