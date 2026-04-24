import pool from '../database/db.js';
import { logger } from '../config/logger.js';

/**
 * Limpa IPs bloqueados expirados
 */
export async function limparIPsExpirados() {
  // ✅ Opção A: Para query simples, use pool.query() direto (mais limpo)
  try {
    const result = await pool.query(
      'DELETE FROM ips_bloqueados WHERE expires_at < NOW()'
    );
    
    if (result.rowCount > 0) {
      logger.info(`🧹 ${result.rowCount} IPs expirados removidos`);
    }
  } catch (error) {
    logger.error('❌ Erro ao limpar IPs expirados:', error.message);
  }
  // ✅ Não precisa de client.release() quando usa pool.query()
}

/**
 * Limpa registros de auditoria antigos (> 90 dias)
 */
export async function limparAuditoriaAntiga() {
  try {
    const result = await pool.query(
      "DELETE FROM auditoria WHERE created_at < NOW() - INTERVAL '90 days'"
    );
    
    if (result.rowCount > 0) {
      logger.info(`🧹 ${result.rowCount} registros de auditoria antigos removidos`);
    }
  } catch (error) {
    logger.error('❌ Erro ao limpar auditoria antiga:', error.message);
  }
}

/**
 * [OPCIONAL] Se precisar de transação ou múltiplas queries relacionadas:
 * Use pool.connect() com client.release() no finally
 */
export async function limparDadosComplexos() {
  let client;
  
  try {
    client = await pool.connect(); // ✅ Correto para pg
    
    await client.query('BEGIN');
    
    // Múltiplas queries relacionadas...
    await client.query('DELETE FROM tabela1 WHERE ...');
    await client.query('UPDATE tabela2 SET ...');
    
    await client.query('COMMIT');
    
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    logger.error('❌ Erro em operação complexa:', error.message);
    throw error;
    
  } finally {
    if (client) client.release(); // ⚠️ Sempre libere!
  }
}

/**
 * Função principal de limpeza agendada
 */
export async function limparDadosExpirados() {
  logger.debug('🧹 Iniciando limpeza programada...');
  
  await limparIPsExpirados();
  await limparAuditoriaAntiga();
  
  logger.debug('✨ Limpeza programada concluída');
}