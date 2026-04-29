import 'dotenv/config';
import app from './src/app.js';
import { logger } from './src/config/logger.js';

console.log('--- TESTE DE AMBIENTE ---');
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('JWT_SECRET:', process.env.JWT_SECRET);
console.log('JWT_REFRESH_SECRET:', process.env.JWT_REFRESH_SECRET);
console.log('-------------------------');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🌐 API SDEBR rodando na porta ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Porta ${PORT} já está em uso`);
  } else {
    logger.error('Erro ao iniciar servidor:', err);
  }
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM recebido — encerrando servidor...');
  server.close(() => {
    logger.info('Servidor HTTP encerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT recebido — encerrando servidor...');
  server.close(() => {
    logger.info('Servidor HTTP encerrado');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Exceção não capturada:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rejeitada não tratada:', reason);
  process.exit(1);
});