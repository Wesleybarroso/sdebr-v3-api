// src/controllers/pontosController.js
import pool from '../database/db.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';

// ======================
// ➕ CRIAR PONTO
// ======================
export async function criarPonto(req, res) {
  try {
    const { nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao } = req.body;

    const MAX_PONTOS = parseInt(process.env.MAX_PONTOS_POR_USUARIO) || 2;

    // ✅ Verifica quantos pontos o usuário já tem
    const existingResult = await pool.query(
      'SELECT id, cidade FROM pontos WHERE user_id = $1',
      [req.user.id]
    );
    const pontos = existingResult.rows;

    if (pontos.length >= MAX_PONTOS) {
      return res.status(400).json({ error: `Você já atingiu o limite de ${MAX_PONTOS} ponto(s) de coleta` });
    }

    if (pontos.length > 0 && pontos[0].cidade?.toLowerCase() !== cidade?.toLowerCase()) {
      return res.status(400).json({
        error: 'Todos os seus pontos devem ser na mesma cidade'
      });
    }

    // ✅ INSERT com RETURNING para pegar o ID
    const result = await pool.query(
      `INSERT INTO pontos (nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING id`,
      [nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao, req.user.id]
    );

    const novoId = result.rows[0].id;

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'CRIAR_PONTO',
      entidade: 'pontos',
      entidade_id: novoId,
      ip: req.ip
    });

    logger.info(`Ponto ${novoId} criado por usuário ${req.user.id}`);
    res.status(201).json({ id: novoId, message: 'Ponto de coleta criado com sucesso' });

  } catch (err) {
    logger.error('Erro ao criar ponto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LISTAR PONTOS
// ======================
export async function listarPontos(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { cidade, estado, busca } = req.query;

    // ✅ Query base com placeholders dinâmicos
    let query = `
      SELECT p.id, p.nome, p.rua, p.numero, p.bairro, p.cidade, p.estado, p.cep,
             p.complemento, p.descricao, p.ativo, p.created_at,
             u.nome as responsavel
      FROM pontos p
      LEFT JOIN usuarios u ON p.user_id = u.id
      WHERE p.ativo = true
    `;
    const params = [];
    let paramIndex = 1;

    if (cidade) {
      query += ` AND LOWER(p.cidade) = LOWER($${paramIndex++})`;
      params.push(cidade);
    }
    if (estado) {
      query += ` AND UPPER(p.estado) = UPPER($${paramIndex++})`;
      params.push(estado);
    }
    if (busca) {
      query += ` AND (LOWER(p.nome) LIKE LOWER($${paramIndex++}) OR LOWER(p.bairro) LIKE LOWER($${paramIndex++}))`;
      params.push(`%${busca}%`, `%${busca}%`);
    }

    // Count query
    const countQuery = query.replace(
      /SELECT.*?FROM pontos/s,
      'SELECT COUNT(*) as total FROM pontos'
    );
    const totalResult = await pool.query(countQuery, params);
    const total = parseInt(totalResult.rows[0].total);

    // Adiciona paginação
    query += ` ORDER BY p.nome ASC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

        const result = await pool.query(query, params);

        res.json({
      data: result.rows,
      paginacao: {
        total,
        page,
        limit,
        paginas: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar pontos:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔍 BUSCAR PONTO POR ID
// ======================
export async function buscarPonto(req, res) {
  try {
    const { id } = req.params;

    // ✅ Busca ponto principal
    const pontoResult = await pool.query(
      `SELECT p.*, u.nome as responsavel, u.email as responsavel_email
       FROM pontos p
       LEFT JOIN usuarios u ON p.user_id = u.id
       WHERE p.id = $1 AND p.ativo = true`,
      [id]
    );

    const ponto = pontoResult.rows[0];

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado' });
    }

    // ✅ Busca necessidades do ponto
    const necessidadesResult = await pool.query(
      `SELECT id, tipo, quantidade, quantidade_restante, porcentagem, urgencia, status
       FROM necessidades 
       WHERE ponto_id = $1 AND status = 'precisando'
       ORDER BY 
         CASE urgencia 
           WHEN 'alta' THEN 1 
           WHEN 'media' THEN 2 
           WHEN 'baixa' THEN 3 
           ELSE 4 
         END ASC,
         created_at DESC`,
      [id]
    );

    res.json({ ...ponto, necessidades: necessidadesResult.rows });

  } catch (err) {
    logger.error('Erro ao buscar ponto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ✏️ ATUALIZAR PONTO
// ======================
export async function atualizarPonto(req, res) {
  try {
    const { id } = req.params;
    const { nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao } = req.body;

    // ✅ Verifica se ponto existe e permissão
    const pontoResult = await pool.query(
      'SELECT id, user_id FROM pontos WHERE id = $1',
      [id]
    );
    const ponto = pontoResult.rows[0];

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado' });
    }

    if (req.user.role !== 'admin' && ponto.user_id !== req.user?.id) {
      return res.status(403).json({ error: 'Você não tem permissão para editar este ponto' });
    }

    // ✅ UPDATE com COALESCE e parâmetros numerados
    await pool.query(
      `UPDATE pontos SET
        nome        = COALESCE($1, nome),
        rua         = COALESCE($2, rua),
        numero      = COALESCE($3, numero),
        bairro      = COALESCE($4, bairro),
        cidade      = COALESCE($5, cidade),
        estado      = COALESCE($6, estado),
        cep         = COALESCE($7, cep),
        complemento = COALESCE($8, complemento),
        descricao   = COALESCE($9, descricao),
        updated_at  = NOW()
       WHERE id = $10`,
      [nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao, id]
    );

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'ATUALIZAR_PONTO',
      entidade: 'pontos',
      entidade_id: id,
      ip: req.ip
    });

    logger.info(`Ponto ${id} atualizado por usuário ${req.user.id}`);
    res.json({ message: 'Ponto atualizado com sucesso' });

  } catch (err) {
    logger.error('Erro ao atualizar ponto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ❌ DELETAR PONTO
// ======================
export async function deletarPonto(req, res) {
  try {
    const { id } = req.params;

    // ✅ Verifica ponto e permissão
    const pontoResult = await pool.query(
      'SELECT id, user_id, nome FROM pontos WHERE id = $1',
      [id]
    );
    const ponto = pontoResult.rows[0];

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado' });
    }

    if (req.user.role !== 'admin' && ponto.user_id !== req.user?.id) {
      return res.status(403).json({ error: 'Você não tem permissão para deletar este ponto' });
    }

    // ✅ DELETE (CASCADE no banco deleta necessidades/doações vinculadas)
    await pool.query('DELETE FROM pontos WHERE id = $1', [id]);

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'DELETAR_PONTO',
      entidade: 'pontos',
      entidade_id: id,
      detalhes: { nome: ponto.nome },
      ip: req.ip
    });

    logger.warn(`Ponto ${id} (${ponto.nome}) deletado por usuário ${req.user.id}`);
    res.json({ message: 'Ponto deletado com sucesso' });

  } catch (err) {
    logger.error('Erro ao deletar ponto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔍 MEUS PONTOS
// ======================
export async function meusPontos(req, res) {
  try {
    // ✅ Query com subqueries para contagens
    const result = await pool.query(
      `SELECT p.*, 
        (SELECT COUNT(*) FROM necessidades n WHERE n.ponto_id = p.id AND n.status = 'precisando') as necessidades_pendentes,
        (SELECT COUNT(*) FROM necessidades n WHERE n.ponto_id = p.id) as total_necessidades,
        (SELECT COUNT(*) FROM doacoes d WHERE d.ponto_id = p.id) as total_doacoes
       FROM pontos p
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);

  } catch (err) {
    logger.error('Erro ao buscar meus pontos:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}