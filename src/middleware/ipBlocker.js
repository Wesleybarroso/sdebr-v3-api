// src/middleware/ipBlocker.js
import pool from '../database/db.js';
import { logger } from '../config/logger.js';

/**
 * Middleware para bloquear IPs com muitas requisições falhas
 */
export async function ipBlocker(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
  
  try {
    // ✅ Usa pool.query() direto (API correta do pg para PostgreSQL)
    const result = await pool.query(
      `SELECT id, motivo, expires_at 
       FROM ips_bloqueados 
       WHERE ip = $1 AND expires_at > NOW()
       ORDER BY blocked_at DESC 
       LIMIT 1`,
      [ip]
    );
    
    if (result.rows.length > 0) {
      const bloqueio = result.rows[0];
      logger.warn(`🚫 IP bloqueado: ${ip} - ${bloqueio.motivo}`);
      
      return res.status(403).json({
        error: 'Acesso bloqueado',
        motivo: bloqueio.motivo,
        expires_at: bloqueio.expires_at
      });
    }
    
    // IP liberado, continua a requisição
    next();
    
  } catch (error) {
    // Fail-open: em caso de erro no banco, não bloqueie o usuário
    logger.error('❌ Erro ao verificar IP blocker:', error.message);
    next();
  }
}

/**
 * ✅ Registra um IP como bloqueado (exportado como 'blockIP' para compatibilidade)
 * @param {string} ip - Endereço IP
 * @param {string} motivo - Motivo do bloqueio
 * @param {number} minutos - Tempo de bloqueio em minutos
 */
export async function blockIP(ip, motivo, minutos = 30) {
  try {
    await pool.query(
      `INSERT INTO ips_bloqueados (ip, motivo, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${minutos} minutes')
       ON CONFLICT (ip) 
       DO UPDATE SET 
         motivo = EXCLUDED.motivo,
         expires_at = EXCLUDED.expires_at,
         bloqueios = ips_bloqueados.bloqueios + 1`,
      [ip, motivo]
    );
    
    logger.info(`🔒 IP bloqueado: ${ip} por ${minutos}min - ${motivo}`);
    
  } catch (error) {
    logger.error('❌ Erro ao bloquear IP:', error.message);
  }
}

/**
 * ✅ Desbloqueia um IP manualmente (exportado como 'unblockIP' para compatibilidade)
 * @param {string} ip - Endereço IP a ser desbloqueado
 * @returns {Promise<boolean>} true se desbloqueou, false se não encontrou
 */
export async function unblockIP(ip) {
  try {
    const result = await pool.query(
      'DELETE FROM ips_bloqueados WHERE ip = $1',
      [ip]
    );
    
    if (result.rowCount > 0) {
      logger.info(`🔓 IP desbloqueado: ${ip}`);
      return true;
    }
    logger.debug(`ℹ️ IP não estava bloqueado: ${ip}`);
    return false;
    
  } catch (error) {
    logger.error('❌ Erro ao desbloquear IP:', error.message);
    return false;
  }
}

// ============================================
// 🔄 Aliases em português (opcional, para uso interno)
// ============================================
export const bloquearIP = blockIP;        // Alias PT-BR para blockIP
export const desbloquearIP = unblockIP;   // Alias PT-BR para unblockIP