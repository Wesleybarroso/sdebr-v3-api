import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import routes from './routes/index.js';
import { initDB } from './database/db.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { ipBlocker } from './middleware/ipBlocker.js';
import { limparDadosExpirados } from './utils/cleanup.js';
import { corsConfig } from './config/cors.js';
import { logger } from './config/logger.js';

const app = express();

// ======================
// 🔧 PROXY
// ======================
app.set('trust proxy', 1);

// ======================
// 🔐 SEGURANÇA WEB
// ======================
app.use(helmet());
app.use(cors(corsConfig));

// ======================
// 🔧 PARSE (com limite anti-DoS)
// ======================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ======================
// 🚫 PROTEÇÃO DE ACESSO
// ======================
app.use(ipBlocker);
app.use(globalLimiter);

// ======================
// 📜 LOG DE REQUESTS
// ======================
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ip: req.ip?.replace('::ffff:', ''),
      duration: `${Date.now() - start}ms`,
      userAgent: req.headers['user-agent']
    });
  });
  next();
});

// ======================
// 🌐 ROTAS
// ======================
app.use('/api/v1', routes);

// ======================
// 🧪 HEALTH CHECK
// ======================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    app: 'SDEBR API',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// ======================
// ❌ 404
// ======================
app.use((req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    path: req.originalUrl
  });
});

// ======================
// 🚨 ERRO GLOBAL
// ======================
app.use((err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no body da requisição' });
  }

  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ======================
// 🗄️ BANCO + LIMPEZA AGENDADA
// ======================
async function start() {
  try {
    await initDB();
    logger.info('Banco de dados inicializado com sucesso');

    // limpeza imediata + agendada a cada hora
    await limparDadosExpirados();
    const cleanupInterval = setInterval(limparDadosExpirados, 60 * 60 * 1000);

    process.on('SIGTERM', () => clearInterval(cleanupInterval));
    process.on('SIGINT', () => clearInterval(cleanupInterval));

  } catch (err) {
    logger.error('Falha crítica ao inicializar banco de dados:', err);
    process.exit(1);
  }
}

start();

export default app;