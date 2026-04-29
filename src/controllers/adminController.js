// src/controllers/adminController.js
import pool from '../database/db.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';
import { unblockIP } from '../middleware/ipBlocker.js';
import bcrypt from 'bcrypt';  

const SALT_ROUNDS = 10;
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
// ➕ CRIAR USUÁRIO (ADMIN)
// ======================
export async function criarUsuario(req, res) {
  try {
    const { nome, email, senha, telefone, role, endereco } = req.body;

    // Validações
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    // Verificar email duplicado
    const emailExistente = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );
    
    if (emailExistente.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(senha, SALT_ROUNDS);

    // Inserir no banco
    const result = await pool.query(
      `INSERT INTO usuarios 
       (nome, email, senha, telefone, role, endereco, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) 
       RETURNING id, nome, email, telefone, role, created_at`,
      [nome, email, hashedPassword, telefone, role || 'admin', endereco]
    );

    // Auditoria
    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'CRIAR_USUARIO',
      entidade: 'usuarios',
      entidade_id: result.rows[0].id,
      detalhes: { nome, email, role },
      ip: req.ip
    });

    res.status(201).json({ 
      message: 'Usuário criado com sucesso',
      usuario: result.rows[0] 
    });

  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({ error: 'Erro interno ao criar usuário' });
  }
}

// ============================================================================
// ✏️ ATUALIZAR USUÁRIO (ADMIN)
// ============================================================================
export async function atualizarUsuario(req, res) {
  try {
    const { id } = req.params;
    const { nome, email, telefone, role, endereco } = req.body;

    // Atualizar no banco (COALESCE mantém valor antigo se não for enviado)
    const result = await pool.query(
      `UPDATE usuarios 
       SET nome = COALESCE($1, nome),
           email = COALESCE($2, email),
           telefone = COALESCE($3, telefone),
           role = COALESCE($4, role),
           endereco = COALESCE($5, endereco),
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, nome, email, telefone, role, created_at, updated_at`,
      [nome, email, telefone, role, endereco, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Auditoria
    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'ATUALIZAR_USUARIO',
      entidade: 'usuarios',
      entidade_id: id,
      detalhes: { nome, email, telefone, role },
      ip: req.ip
    });

    res.json({ 
      message: 'Usuário atualizado com sucesso',
      usuario: result.rows[0] 
    });

  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar usuário' });
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

