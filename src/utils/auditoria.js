import pool from '../database/db.js';
import { logger } from '../config/logger.js';

/**
 * Função principal que grava no banco de dados
 */
export async function registrarAuditoria({ usuario_id, acao, entidade, entidade_id, detalhes, ip }) {
  try {
    await pool.query(
      `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuario_id, acao, entidade, entidade_id, detalhes, ip]
    );
  } catch (err) {
    logger.error('❌ Erro ao gravar log de auditoria no banco:', err.message);
    // Não damos throw aqui para não derrubar a requisição principal do usuário
  }
}

/**
 * Middleware para registrar ações automaticamente em rotas
 */
export function middlewareAuditoria(acao, entidade) {
  return async (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Agora a função registrarAuditoria existe e pode ser chamada!
        registrarAuditoria({
          usuario_id: req.usuario?.id || req.user?.id || null,
          acao,
          entidade,
          entidade_id: data?.id || data?.ponto?.id || null,
          detalhes: JSON.stringify(data).substring(0, 500), // Captura um resumo dos dados
          ip: req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress
        });
      }
      
      res.json = originalJson;
      return originalJson.call(this, data);
    };
    
    next();
  };
}