import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// 🧹 LIMPAR IPs EXPIRADOS
// ======================
export async function limparIPsExpirados() {
  try {
    const db = await connectDB();
    const result = await db.run(
      `DELETE FROM ips_bloqueados WHERE expires_at <= datetime('now')`
    );

    if (result.changes > 0) {
      logger.info(`Limpeza: ${result.changes} IP(s) expirado(s) removido(s)`);
    } else {
      logger.debug('Limpeza de IPs: nenhum registro expirado encontrado');
    }
  } catch (err) {
    logger.error('Erro ao limpar IPs expirados:', err);
  }
}

// ======================
// 🧹 LIMPAR LOGS DE AUDITORIA ANTIGOS (> 90 dias)
// ======================
export async function limparAuditoriaAntiga() {
  try {
    const db = await connectDB();
    const result = await db.run(
      `DELETE FROM auditoria WHERE created_at <= datetime('now', '-90 days')`
    );

    if (result.changes > 0) {
      logger.info(`Limpeza: ${result.changes} log(s) de auditoria antigos removidos`);
    }
  } catch (err) {
    logger.error('Erro ao limpar auditoria antiga:', err);
  }
}

// ======================
// 🧹 LIMPEZA GERAL (chamada pelo scheduler)
// ======================
export async function limparDadosExpirados() {
  logger.debug('Iniciando limpeza programada...');
  await limparIPsExpirados();
  await limparAuditoriaAntiga();
  logger.debug('Limpeza programada concluída');
}