import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// 📋 REGISTRAR AÇÃO DE AUDITORIA
// ======================
export async function registrarAuditoria({ usuario_id, acao, entidade, entidade_id, detalhes, ip }) {
  try {
    const db = await connectDB();
    await db.run(
      `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        usuario_id || null,
        acao,
        entidade || null,
        entidade_id || null,
        detalhes ? JSON.stringify(detalhes) : null,
        ip || null
      ]
    );
  } catch (err) {
    // auditoria nunca deve quebrar a operação principal
    logger.error('Erro ao registrar auditoria:', err);
  }
}