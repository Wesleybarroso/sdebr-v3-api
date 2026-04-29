// src/controllers/emailConfigController.js
import pool from '../database/db.js';
import { encrypt } from '../utils/encryption.js';
import { emailService } from '../services/emailService.js';
import { registrarAuditoria } from '../utils/auditoria.js';
import { logger } from '../config/logger.js';

// 🔹 Listar configuração atual (sem credenciais)
export async function getEmailConfig(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, provider, from_name, from_email, reply_to, 
              is_active, last_tested_at, test_status, created_at, updated_at
       FROM email_config 
       ORDER BY is_active DESC, created_at DESC 
       LIMIT 1`
    );
    
    res.json({ config: result.rows[0] || null });
    
  } catch (err) {
    logger.error('Erro ao listar email config:', err.message);
    res.status(500).json({ error: 'Erro ao carregar configuração' });
  }
}

// 🔹 Salvar/Atualizar configuração
export async function saveEmailConfig(req, res) {
  try {
    const { 
      provider, 
      from_name, 
      from_email, 
      reply_to,
      credentials, // { host, port, user, pass } ou { apiKey }
      is_active 
    } = req.body;
    
    if (!provider || !from_email || !credentials) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }
    
    // Criptografa credenciais
    const encrypted = encrypt(credentials);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Desativa configs anteriores se esta for ativa
      if (is_active) {
        await client.query('UPDATE email_config SET is_active = FALSE');
      }
      
      // Upsert
      const result = await client.query(
        `INSERT INTO email_config 
         (configured_by, provider, credentials_encrypted, from_name, from_email, reply_to, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           provider = EXCLUDED.provider,
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           from_name = EXCLUDED.from_name,
           from_email = EXCLUDED.from_email,
           reply_to = EXCLUDED.reply_to,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()
         RETURNING id, provider, from_name, from_email, reply_to, is_active`,
        [
          req.user.id,
          provider,
          encrypted,
          from_name || 'SDEBR',
          from_email,
          reply_to || from_email,
          is_active || false
        ]
      );
      
      await client.query('COMMIT');
      
      // Auditoria
      await registrarAuditoria({
        usuario_id: req.user.id,
        acao: 'EMAIL_CONFIG_UPDATED',
        entidade: 'email_config',
        entidade_id: result.rows[0].id,
        detalhes: { provider, from_email, is_active },
        ip: req.ip
      });
      
      res.json({ 
        message: 'Configuração de email salva com sucesso',
        config: result.rows[0]
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch (err) {
    logger.error('Erro ao salvar email config:', err.message);
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
}

// 🔹 Testar configuração
export async function testEmailConfig(req, res) {
  try {
    const { provider, credentials, from_email, from_name } = req.body;
    
    if (!provider || !credentials || !from_email) {
      return res.status(400).json({ error: 'Dados necessários para teste faltando' });
    }
    
    // Criptografa temporariamente para usar o emailService
    const encrypted = encrypt(credentials);
    
    const testResult = await emailService.testConfig({
      provider,
      credentials_encrypted: encrypted,
      from_email,
      from_name: from_name || 'SDEBR'
    });
    
    // Atualiza status do teste no banco (se houver config salva)
    await pool.query(
      `UPDATE email_config 
       SET last_tested_at = NOW(), test_status = $1 
       WHERE is_active = TRUE`,
      [testResult.success ? 'success' : 'failed']
    );
    
    res.json(testResult);
    
  } catch (err) {
    logger.error('Erro ao testar email config:', err.message);
    res.status(400).json({ error: `Falha no teste: ${err.message}` });
  }
}

// 🔹 Desativar configuração
export async function deactivateEmailConfig(req, res) {
  try {
    await pool.query('UPDATE email_config SET is_active = FALSE');
    
    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'EMAIL_CONFIG_DEACTIVATED',
      entidade: 'email_config',
      ip: req.ip
    });
    
    res.json({ message: 'Configuração de email desativada' });
    
  } catch (err) {
    logger.error('Erro ao desativar email config:', err.message);
    res.status(500).json({ error: 'Erro ao desativar configuração' });
  }
}