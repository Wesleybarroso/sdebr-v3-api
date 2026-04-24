// src/controllers/doacoesController.js
import pool from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// 🤝 REGISTRAR DOAÇÃO
// ======================
export async function registrarDoacao(req, res) {
  const { ponto_id, tipo, quantidade } = req.body;
  let client;

  // 🔴 Validação básica
  if (!ponto_id || !tipo || !quantidade) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  // ✅ Validação de quantidade positiva
  if (quantidade <= 0) {
    return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });
  }

  try {
    client = await pool.connect();

    // 🔍 Verifica se o ponto existe e está ativo
    const pontoResult = await client.query(
      'SELECT id, nome FROM pontos WHERE id = $1 AND ativo = $2',
      [ponto_id, true]
    );

    if (pontoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ponto não encontrado ou inativo' });
    }

    // 🔍 Busca necessidade relacionada
    const necessidadeResult = await client.query(
      `SELECT id, ponto_id, tipo, quantidade, quantidade_restante, status
       FROM necessidades 
       WHERE ponto_id = $1 AND tipo = $2 AND status = 'precisando'`,
      [ponto_id, tipo]
    );

    const necessidade = necessidadeResult.rows[0];
    await client.query('BEGIN');

    try {
      // 💾 Salva doação com RETURNING
      const doacaoResult = await client.query(
        `INSERT INTO doacoes (ponto_id, usuario_id, tipo, quantidade, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id`,
        [ponto_id, req.user?.id || null, tipo, quantidade]
      );

      const doacaoId = doacaoResult.rows[0].id;

      // 🔥 ATUALIZA NECESSIDADE (se existir)
      if (necessidade) {
        let restante = necessidade.quantidade_restante ?? necessidade.quantidade;
        restante = restante - quantidade;
        if (restante < 0) restante = 0;

        let porcentagem = 0;
        if (necessidade.quantidade > 0) {
          porcentagem = Math.floor(
            ((necessidade.quantidade - restante) / necessidade.quantidade) * 100
          );
        }

        let urgencia = 'alta';
        if (porcentagem >= 100) urgencia = 'ok';
        else if (porcentagem >= 70) urgencia = 'baixa';
        else if (porcentagem >= 40) urgencia = 'media';

        let status = 'precisando';
        if (restante === 0) status = 'ok';

        await client.query(
          `UPDATE necessidades 
           SET quantidade_restante = $1, 
               porcentagem = $2, 
               urgencia = $3, 
               status = $4, 
               updated_at = NOW()
           WHERE id = $5`,
          [restante, porcentagem, urgencia, status, necessidade.id]
        );

        logger.info(`Doação ${doacaoId} atualizou necessidade ${necessidade.id}`);
      } else {
        logger.info(`Doação ${doacaoId} registrada sem necessidade correspondente`);
      }

      await client.query('COMMIT');

      res.json({
        message: 'Doação registrada com sucesso',
        doacao_id: doacaoId,
        necessidade_atualizada: !!necessidade
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    logger.error('Erro ao registrar doação:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
}

// ======================
// 📋 LISTAR DOAÇÕES
// ======================
export async function listarDoacoes(req, res) {
  try {
    const { page = 1, limit = 20, ponto_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT d.*, p.nome as ponto_nome, p.cidade, p.estado, u.nome as usuario_nome
      FROM doacoes d
      JOIN pontos p ON d.ponto_id = p.id
      LEFT JOIN usuarios u ON d.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (ponto_id) {
      query += ` AND d.ponto_id = $${paramIndex++}`;
      params.push(ponto_id);
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(parseInt(limit), offset);

    const dataResult = await pool.query(query, params);

    // Contagem total
    let countQuery = 'SELECT COUNT(*) as total FROM doacoes d WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (ponto_id) {
      countQuery += ` AND d.ponto_id = $${countIndex++}`;
      countParams.push(ponto_id);
    }
    
    const totalResult = await pool.query(countQuery, countParams);
    const total = parseInt(totalResult.rows[0].total);

    // ✅ CORREÇÃO FINAL: data: dataResult.rows (chave: valor)
        res.json({
       data: dataResult.rows,
       paginacao: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        paginas: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (err) {
    logger.error('Erro ao listar doações:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ❌ DELETAR DOAÇÃO
// ======================
export async function deletarDoacao(req, res) {
  const { id } = req.params;
  let client;

  try {
    client = await pool.connect();

    const doacaoResult = await client.query(
      'SELECT id, ponto_id, tipo, quantidade FROM doacoes WHERE id = $1',
      [id]
    );

    if (doacaoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Doação não encontrada' });
    }
    const doacao = doacaoResult.rows[0];

    const necessidadeResult = await client.query(
      `SELECT id, ponto_id, tipo, quantidade, quantidade_restante 
       FROM necessidades 
       WHERE ponto_id = $1 AND tipo = $2`,
      [doacao.ponto_id, doacao.tipo]
    );
    const necessidade = necessidadeResult.rows[0];

    await client.query('BEGIN');

    try {
      await client.query('DELETE FROM doacoes WHERE id = $1', [id]);

      if (necessidade) {
        let novoRestante = (necessidade.quantidade_restante || 0) + doacao.quantidade;
        if (novoRestante > necessidade.quantidade) {
          novoRestante = necessidade.quantidade;
        }

        let novaPorcentagem = 0;
        if (necessidade.quantidade > 0) {
          novaPorcentagem = Math.floor(
            ((necessidade.quantidade - novoRestante) / necessidade.quantidade) * 100
          );
        }

        let novoStatus = 'precisando';
        if (novoRestante === 0) novoStatus = 'ok';

        let novaUrgencia = 'alta';
        if (novaPorcentagem >= 100) novaUrgencia = 'ok';
        else if (novaPorcentagem >= 70) novaUrgencia = 'baixa';
        else if (novaPorcentagem >= 40) novaUrgencia = 'media';

        await client.query(
          `UPDATE necessidades 
           SET quantidade_restante = $1, 
               porcentagem = $2, 
               urgencia = $3, 
               status = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [novoRestante, novaPorcentagem, novaUrgencia, novoStatus, necessidade.id]
        );

        logger.info(`Doação ${id} deletada, necessidade ${necessidade.id} restaurada`);
      }

      await client.query('COMMIT');
      logger.info(`Doação ${id} deletada por usuário ${req.user?.id || 'sistema'}`);
      res.json({ message: 'Doação deletada com sucesso' });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    logger.error('Erro ao deletar doação:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
}