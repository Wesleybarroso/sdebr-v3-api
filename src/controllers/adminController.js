import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';
import { unblockIP } from '../middleware/ipBlocker.js';

// ======================
// 🚫 IPS BLOQUEADOS
// ======================

// listar IPs bloqueados (com paginação)
export async function listarIPsBloqueados(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const db = await connectDB();

    const [ips, total] = await Promise.all([
      db.all(
        `SELECT id, ip, motivo, bloqueios, blocked_at, expires_at
         FROM ips_bloqueados
         ORDER BY blocked_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      db.get('SELECT COUNT(*) as total FROM ips_bloqueados')
    ]);

    res.json({
      data: ips,
      paginacao: {
        total: total.total,
        page,
        limit,
        paginas: Math.ceil(total.total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar IPs bloqueados:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// desbloquear IP manualmente
export async function desbloquearIP(req, res) {
  try {
    const { ip } = req.params;
    const db = await connectDB();

    const existe = await db.get(
      'SELECT id FROM ips_bloqueados WHERE ip = ?',
      [ip]
    );

    if (!existe) {
      return res.status(404).json({ error: 'IP não encontrado na lista de bloqueios' });
    }

    await unblockIP(ip);

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'DESBLOQUEAR_IP',
      detalhes: { ip },
      ip: req.ip
    });

    logger.info(`Admin ${req.user.id} desbloqueou IP: ${ip}`);
    res.json({ message: 'IP desbloqueado com sucesso' });

  } catch (err) {
    logger.error('Erro ao desbloquear IP:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 👤 APROVAÇÃO DE PONTOS
// ======================

// listar solicitações pendentes (com paginação)
export async function listarSolicitacoes(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const db = await connectDB();

    const [users, total] = await Promise.all([
      db.all(
        `SELECT id, nome, email, status, created_at
         FROM usuarios
         WHERE status = 'pendente'
         ORDER BY created_at ASC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      db.get(`SELECT COUNT(*) as total FROM usuarios WHERE status = 'pendente'`)
    ]);

    res.json({
      data: users,
      paginacao: {
        total: total.total,
        page,
        limit,
        paginas: Math.ceil(total.total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar solicitações:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// aprovar usuário como ponto
export async function aprovarPonto(req, res) {
  try {
    const { id } = req.params;
    const db = await connectDB();

    const user = await db.get(
      'SELECT id, nome, status, role FROM usuarios WHERE id = ?',
      [id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (user.status === 'ativo' && user.role === 'ponto') {
      return res.status(400).json({ error: 'Usuário já é um ponto de coleta' });
    }

    if (user.status !== 'pendente') {
      return res.status(400).json({ error: 'Usuário não está aguardando aprovação' });
    }

    await db.run(
      `UPDATE usuarios SET status = 'ativo', role = 'ponto', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'APROVAR_PONTO',
      entidade: 'usuarios',
      entidade_id: id,
      detalhes: { nome: user.nome },
      ip: req.ip
    });

    logger.info(`Admin ${req.user.id} aprovou usuário ${id} como ponto`);
    res.json({ message: 'Usuário aprovado como ponto de coleta com sucesso' });

  } catch (err) {
    logger.error('Erro ao aprovar ponto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// rejeitar solicitação
export async function rejeitarPonto(req, res) {
  try {
    const { id } = req.params;
    const db = await connectDB();

    const user = await db.get(
      'SELECT id, nome, status, role FROM usuarios WHERE id = ?',
      [id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (user.status === 'rejeitado') {
      return res.status(400).json({ error: 'Solicitação já foi rejeitada' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Não é possível rejeitar um administrador' });
    }

    if (user.status !== 'pendente') {
      return res.status(400).json({ error: 'Usuário não está aguardando aprovação' });
    }

    await db.run(
      `UPDATE usuarios SET status = 'rejeitado', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'REJEITAR_PONTO',
      entidade: 'usuarios',
      entidade_id: id,
      detalhes: { nome: user.nome },
      ip: req.ip
    });

    logger.warn(`Admin ${req.user.id} rejeitou usuário ${id}`);
    res.json({ message: 'Solicitação rejeitada' });

  } catch (err) {
    logger.error('Erro ao rejeitar ponto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📊 DASHBOARD ADMIN
// ======================
export async function getDashboard(req, res) {
  try {
    const db = await connectDB();

    const [
      totalUsuarios,
      pendentes,
      totalPontos,
      totalNecessidades,
      totalDoacoes,
      ipsBloqueados,
      doacoesHoje
    ] = await Promise.all([
      db.get('SELECT COUNT(*) as total FROM usuarios WHERE role != ?', ['admin']),
      db.get(`SELECT COUNT(*) as total FROM usuarios WHERE status = 'pendente'`),
      db.get('SELECT COUNT(*) as total FROM pontos'),
      db.get(`SELECT COUNT(*) as total FROM necessidades WHERE status = 'precisando'`),
      db.get('SELECT COUNT(*) as total FROM doacoes'),
      db.get(`SELECT COUNT(*) as total FROM ips_bloqueados WHERE expires_at > datetime('now')`),
      db.get(`SELECT COUNT(*) as total FROM doacoes WHERE DATE(created_at) = DATE('now')`)
    ]);

    res.json({
      usuarios: {
        total: totalUsuarios.total,
        pendentes: pendentes.total
      },
      pontos: { total: totalPontos.total },
      necessidades: { precisando: totalNecessidades.total },
      doacoes: {
        total: totalDoacoes.total,
        hoje: doacoesHoje.total
      },
      seguranca: {
        ips_bloqueados: ipsBloqueados.total
      }
    });

  } catch (err) {
    logger.error('Erro no dashboard admin:', err);
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

    const db = await connectDB();

    const logs = await db.all(
      `SELECT a.id, a.acao, a.entidade, a.entidade_id, a.detalhes, a.ip, a.created_at,
              u.nome as usuario_nome, u.email as usuario_email
       FROM auditoria a
       LEFT JOIN usuarios u ON a.usuario_id = u.id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const total = await db.get('SELECT COUNT(*) as total FROM auditoria');

    res.json({
      data: logs,
      paginacao: {
        total: total.total,
        page,
        limit,
        paginas: Math.ceil(total.total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar auditoria:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LISTAR LOGS (SISTEMA)
// ======================
export async function listarLogs(req, res) {
  try {
    const db = await connectDB();
    const logs = await db.all(`
      SELECT * FROM logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    logger.error('Erro ao listar logs:', err);
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

    const db = await connectDB();

    const [usuarios, total] = await Promise.all([
      db.all(
        `SELECT id, nome, email, role, status, created_at, ultimo_login
         FROM usuarios
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      db.get('SELECT COUNT(*) as total FROM usuarios')
    ]);

    res.json({
      data: usuarios,
      paginacao: {
        total: total.total,
        page,
        limit,
        paginas: Math.ceil(total.total / limit)
      }
    });
  } catch (err) {
    logger.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}