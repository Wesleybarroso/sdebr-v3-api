import pool from '../database/db.js';
import { logger } from '../config/logger.js';
import bcrypt from 'bcrypt';

/**
 * Cria usuário admin padrão se não existir
 */
export async function seedAdmin() {
  let client; // ✅ Declare fora do try para usar no finally
  
  try {
    client = await pool.connect(); // ✅ Conecta ao pool
    
    // Verifica se admin já existe (usa parâmetro para evitar SQL injection)
    const exists = await client.query(
      'SELECT id FROM usuarios WHERE email = $1',
      ['admin@sdebr.com']
    );
    
    if (exists.rows.length > 0) {
      logger.info('👤 Admin já existe, pulando seed');
      return;
    }
    
    // Hash da senha
    const senhaHash = await bcrypt.hash('admin123', 10);
    
    // Insert com parâmetros ($1, $2, etc.) — NUNCA concatene strings!
    await client.query(
      `INSERT INTO usuarios (
        nome, email, senha, role, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        'Administrador',
        'admin@sdebr.com',
        senhaHash,
        'admin',        // ✅ Valor texto, não nome de coluna
        'ativo'
      ]
    );
    
    logger.info('👤 Admin padrão criado: admin@sdebr.com / admin123');
    
  } catch (error) {
    logger.error('❌ Erro ao criar admin inicial:', error.message);
    // Não lança o erro para não travar o servidor em dev
    // Se quiser travar: throw error;
    
  } finally {
    // ✅ Libera a conexão apenas se ela foi criada
    if (client) {
      client.release();
    }
  }
}