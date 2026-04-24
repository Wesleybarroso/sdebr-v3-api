// src/controllers/adminController.js
import pool from '../database/db.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';
import { unblockIP } from '../middleware/ipBlocker.js';

// ======================
// 🚫 IPS BLOQUEADOS
// ======================

export async function listarIPsBloqueados(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    // ✅ PostgreSQL: usa pool.query() com $1, $2
    const [ipsResult, totalResult] = await Promise.all([
      pool.query(
        `SELECT id, ip, motivo, bloqueios, blocked_at, expires_at
         FROM ips_bloqueados
         ORDER BY blocked_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) as total FROM ips_bloqueados')
    ]);

    res.json({
      data: ipsResult.rows,  // ✅ Acessa .rows no PostgreSQL
      paginacao: {
        total: parseInt(totalResult.rows[0].total),
        page,
        limit,
        paginas: Math.ceil(totalResult.rows[0].total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar IPs bloqueados:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function desbloquearIP(req, res) {
  try {
    const { ip } = req.params;

    // ✅ Verifica se existe
    const checkResult = await pool.query(
      'SELECT id FROM ips_bloqueados WHERE ip = $1',
      [ip]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'IP não encontrado na lista de bloqueios' });
    }

    // ✅ Usa a função exportada do middleware
    await unblockIP(ip);

    // ✅ Auditoria (se usuário autenticado)
    if (req.user?.id) {
      await registrarAuditoria({
        usuario_id: req.user.id,
        acao: 'DESBLOQUEAR_IP',
        detalhes: { ip },
        ip: req.ip
      });
      logger.info(`Admin ${req.user.id} desbloqueou IP: ${ip}`);
    }

    res.json({ message: 'IP desbloqueado com sucesso' });

  } catch (err) {
    logger.error('Erro ao desbloquear IP:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 👤 APROVAÇÃO DE PONTOS
// ======================

export async function listarSolicitacoes(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const [usersResult, totalResult] = await Promise.all([
      pool.query(
        `SELECT id, nome, email, telefone, endereco, status, created_at
         FROM usuarios
         WHERE status = 'pendente'
         ORDER BY created_at ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*) as total FROM usuarios WHERE status = 'pendente'`)
    ]);

    res.json({
      data: usersResult.rows,
      paginacao: {
        total: parseInt(totalResult.rows[0].total),
        page,
        limit,
        paginas: Math.ceil(totalResult.rows[0].total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar solicitações:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function aprovarPonto(req, res) {
  let client;
  
  try {
    const { id } = req.params;
    client = await pool.connect(); // ✅ Para transação

    // Verifica usuário
    const userResult = await client.query(
      'SELECT id, nome, status, role FROM usuarios WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const user = userResult.rows[0];

    if (user.status === 'ativo' && user.role === 'ponto') {
      return res.status(400).json({ error: 'Usuário já é um ponto de coleta' });
    }
    if (user.status !== 'pendente') {
      return res.status(400).json({ error: 'Usuário não está aguardando aprovação' });
    }

    // Atualiza com transação
    await client.query('BEGIN');
    await client.query(
      `UPDATE usuarios SET status = 'ativo', role = 'ponto', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await client.query('COMMIT');

    // Auditoria
    if (req.user?.id) {
      await registrarAuditoria({
        usuario_id: req.user.id,
        acao: 'APROVAR_PONTO',
        entidade: 'usuarios',
        entidade_id: id,
        detalhes: { nome: user.nome },
        ip: req.ip
      });
      logger.info(`Admin ${req.user.id} aprovou usuário ${id} como ponto`);
    }

    res.json({ message: 'Usuário aprovado como ponto de coleta com sucesso' });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    logger.error('Erro ao aprovar ponto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release(); // ✅ Sempre libera!
  }
}

export async function rejeitarPonto(req, res) {
  let client;
  
  try {
    const { id } = req.params;
    client = await pool.connect();

    const userResult = await client.query(
      'SELECT id, nome, status, role FROM usuarios WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const user = userResult.rows[0];

    if (user.status === 'rejeitado') {
      return res.status(400).json({ error: 'Solicitação já foi rejeitada' });
    }
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Não é possível rejeitar um administrador' });
    }
    if (user.status !== 'pendente') {
      return res.status(400).json({ error: 'Usuário não está aguardando aprovação' });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE usuarios SET status = 'rejeitado', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await client.query('COMMIT');

    if (req.user?.id) {
      await registrarAuditoria({
        usuario_id: req.user.id,
        acao: 'REJEITAR_PONTO',
        entidade: 'usuarios',
        entidade_id: id,
        detalhes: { nome: user.nome },
        ip: req.ip
      });
      logger.warn(`Admin ${req.user.id} rejeitou usuário ${id}`);
    }

    res.json({ message: 'Solicitação rejeitada' });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    logger.error('Erro ao rejeitar ponto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
}

// ======================
// 📊 DASHBOARD ADMIN
// ======================
export async function getDashboard(req, res) {
  try {
    // ✅ Usa pool.query() para todas as queries
    const [
      totalUsuariosResult,
      pendentesResult,
      totalPontosResult,
      totalNecessidadesResult,
      totalDoacoesResult,
      ipsBloqueadosResult,
      doacoesHojeResult
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM usuarios WHERE role != $1', ['admin']),
      pool.query(`SELECT COUNT(*) as total FROM usuarios WHERE status = 'pendente'`),
      pool.query('SELECT COUNT(*) as total FROM pontos'),
      pool.query(`SELECT COUNT(*) as total FROM necessidades WHERE status = 'precisando'`),
      pool.query('SELECT COUNT(*) as total FROM doacoes'),
      pool.query(`SELECT COUNT(*) as total FROM ips_bloqueados WHERE expires_at > NOW()`),
      pool.query(`SELECT COUNT(*) as total FROM doacoes WHERE DATE(created_at) = CURRENT_DATE`)
    ]);

    res.json({
      usuarios: {
        total: parseInt(totalUsuariosResult.rows[0].total),
        pendentes: parseInt(pendentesResult.rows[0].total)
      },
      pontos: { total: parseInt(totalPontosResult.rows[0].total) },
      necessidades: { precisando: parseInt(totalNecessidadesResult.rows[0].total) },
      doacoes: {
        total: parseInt(totalDoacoesResult.rows[0].total),
        hoje: parseInt(doacoesHojeResult.rows[0].total)
      },
      seguranca: {
        ips_bloqueados: parseInt(ipsBloqueadosResult.rows[0].total)
      }
    });

  } catch (err) {
    logger.error('Erro no dashboard admin:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LOG DE AUDITORIA
// ======================
export async function listarAuditoria(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const [logsResult, totalResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.acao, a.entidade, a.entidade_id, a.detalhes, a.ip, a.created_at,
                u.nome as usuario_nome, u.email as usuario_email
         FROM auditoria a
         LEFT JOIN usuarios u ON a.usuario_id = u.id
         ORDER BY a.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) as total FROM auditoria')
    ]);

    res.json({
      data: logsResult.rows,
      paginacao: {
        total: parseInt(totalResult.rows[0].total),
        page,
        limit,
        paginas: Math.ceil(totalResult.rows[0].total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar auditoria:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LISTAR LOGS (SISTEMA)
// ======================
export async function listarLogs(req, res) {
  try {
    // ⚠️ Tabela 'logs' pode não existir no seu schema - ajuste se necessário
    const result = await pool.query(`
      SELECT * FROM logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    // Se a tabela não existir, retorna array vazio sem quebrar
    if (err.code === '42P01') { // table does not exist
      logger.debug('Tabela logs não existe, retornando vazio');
      return res.json([]);
    }
    logger.error('Erro ao listar logs:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 👥 LISTAR USUÁRIOS
// ======================
export async function listarUsuarios(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const [usuariosResult, totalResult] = await Promise.all([
      pool.query(
        `SELECT id, nome, email, telefone, endereco, role, status, created_at, ultimo_login
         FROM usuarios
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) as total FROM usuarios')
    ]);

    res.json({
      data: usuariosResult.rows,
      paginacao: {
        total: parseInt(totalResult.rows[0].total),
        page,
        limit,
        paginas: Math.ceil(totalResult.rows[0].total / limit)
      }
    });
  } catch (err) {
    logger.error('Erro ao listar usuários:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🗑️ DELETAR USUÁRIOS
// ======================
export async function deletarUsuario(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.user?.id;
    
    // ✅ Verifica se usuário existe
    const userResult = await pool.query(
      'SELECT id, nome, role FROM usuarios WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const user = userResult.rows[0];

    // 🛡️ Segurança: não deletar a si mesmo
    if (Number(id) === Number(adminId)) {
      return res.status(400).json({ 
        error: 'Operação inválida: Você não pode deletar sua própria conta de administrador.' 
      });
    }

    // ✅ Deleta (PostgreSQL usa RETURNING para confirmar)
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);

    // Auditoria
    if (adminId) {
      await registrarAuditoria({
        usuario_id: adminId,
        acao: 'DELETAR_USUARIO',
        entidade: 'usuarios',
        entidade_id: id,
        detalhes: { nome: user.nome, role: user.role },
        ip: req.ip
      });
      logger.warn(`Admin ${adminId} deletou permanentemente o usuário ${id} (${user.nome})`);
    }
    
    res.json({ message: 'Usuário removido com sucesso do sistema' });

  } catch (err) {
    logger.error('Erro ao deletar usuário:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor ao processar exclusão' });
  }
}