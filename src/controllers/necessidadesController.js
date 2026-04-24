// src/controllers/necessidadesController.js
import pool from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// ➕ CRIAR NECESSIDADE
// ======================
export async function criarNecessidade(req, res) {
  try {
    const { ponto_id, tipo, quantidade, urgencia, status } = req.body;

    // ✅ PostgreSQL: verifica ponto com pool.query()
    const pontoResult = await pool.query(
      'SELECT id, user_id, nome FROM pontos WHERE id = $1 AND ativo = $2',
      [ponto_id, true]  // ✅ boolean true, não 1
    );

    const ponto = pontoResult.rows[0];
    
    // ✅ CORREÇÃO: Faltava o if (!ponto)
    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado ou inativo' });
    }

    // Permissão: só dono do ponto ou admin pode criar
    if (ponto.user_id !== req.user?.id && req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Você não pode adicionar necessidade neste ponto'
      });
    }

    // Validações
    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });
    }
    if (!tipo || tipo.trim() === '') {
      return res.status(400).json({ error: 'Tipo da necessidade é obrigatório' });
    }

    // ✅ INSERT com RETURNING para pegar o ID
    const result = await pool.query(
      `INSERT INTO necessidades 
       (ponto_id, tipo, quantidade, quantidade_restante, porcentagem, urgencia, status, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id`,
      [
        ponto_id,
        tipo.trim(),
        quantidade,
        quantidade,  // quantidade_restante inicia igual à quantidade
        0,           // porcentagem inicia em 0
        urgencia || 'media',
        status || 'precisando'
      ]
    );

    const novoId = result.rows[0].id;
    logger.info(`Necessidade ${novoId} criada no ponto ${ponto_id}`);
    
    res.status(201).json({ 
      message: 'Necessidade cadastrada com sucesso',
      id: novoId 
    });

  } catch (err) {
    logger.error('Erro ao criar necessidade:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LISTAR NECESSIDADES
// ======================
export async function listarNecessidades(req, res) {
  try {
    // ✅ Query PostgreSQL com cálculo de percentual
    const result = await pool.query(`
      SELECT 
        n.*, 
        p.nome as ponto_nome, 
        p.cidade,
        (n.quantidade - n.quantidade_restante) AS doado,
        ROUND(
          CAST((n.quantidade - n.quantidade_restante) AS NUMERIC) / NULLIF(n.quantidade, 0) * 100, 
          1
        ) AS percentual_doado
      FROM necessidades n
      JOIN pontos p ON n.ponto_id = p.id
      WHERE n.status = 'precisando'
      ORDER BY 
        CASE n.urgencia 
          WHEN 'alta' THEN 1 
          WHEN 'media' THEN 2 
          WHEN 'baixa' THEN 3 
          ELSE 4 
        END ASC,
        n.created_at DESC
    `);

    res.json(result.rows);  // ✅ Acessa .rows no PostgreSQL

  } catch (err) {
    logger.error('Erro ao listar necessidades:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔍 BUSCAR NECESSIDADE POR ID
// ======================
export async function buscarNecessidade(req, res) {
  try {
    const result = await pool.query(
      `SELECT n.*, p.nome as ponto_nome, p.cidade, p.estado,
       (n.quantidade - n.quantidade_restante) AS doado
       FROM necessidades n
       JOIN pontos p ON n.ponto_id = p.id
       WHERE n.id = $1`,
      [req.params.id]
    );

    const necessidade = result.rows[0];

    if (!necessidade) {
      return res.status(404).json({ error: 'Necessidade não encontrada' });
    }

    res.json(necessidade);

  } catch (err) {
    logger.error('Erro ao buscar necessidade:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ✏️ ATUALIZAR NECESSIDADE
// ======================
export async function atualizarNecessidade(req, res) {
  let client;
  
  try {
    const { id } = req.params;
    const { status, urgencia, quantidade } = req.body;
    
    client = await pool.connect();

    // Busca necessidade
    const necResult = await client.query(
      'SELECT * FROM necessidades WHERE id = $1',
      [id]
    );
    const necessidade = necResult.rows[0];

    if (!necessidade) {
      return res.status(404).json({ error: 'Necessidade não encontrada' });
    }

    // Busca ponto para verificar permissão
    const pontoResult = await client.query(
      'SELECT user_id FROM pontos WHERE id = $1',
      [necessidade.ponto_id]
    );
    const ponto = pontoResult.rows[0];

    if (ponto.user_id !== req.user?.id && req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Você não pode alterar essa necessidade'
      });
    }

    // Calcula novos valores
    let novaQuantidade = necessidade.quantidade;
    let novoRestante = necessidade.quantidade_restante;

    if (quantidade !== undefined && quantidade !== null) {
      novaQuantidade = quantidade;
      novoRestante = Math.min(necessidade.quantidade_restante, novaQuantidade);
    }

    // ✅ CÁLCULO SEGURO DE PORCENTAGEM
    let porcentagem = necessidade.porcentagem;
    if (novaQuantidade > 0) {
      porcentagem = Math.floor(((novaQuantidade - novoRestante) / novaQuantidade) * 100);
    }

    // ✅ UPDATE com parâmetros numerados
    await client.query(
      `UPDATE necessidades 
       SET quantidade = COALESCE($1, quantidade),
           quantidade_restante = COALESCE($2, quantidade_restante),
           porcentagem = COALESCE($3, porcentagem),
           urgencia = COALESCE($4, urgencia),
           status = COALESCE($5, status),
           updated_at = NOW()
       WHERE id = $6`,
      [quantidade, novoRestante, porcentagem, urgencia, status, id]
    );

    logger.info(`Necessidade ${id} atualizada por usuário ${req.user?.id}`);
    res.json({ message: 'Necessidade atualizada com sucesso' });

  } catch (err) {
    logger.error('Erro ao atualizar necessidade:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
}

// ======================
// ❌ DELETAR NECESSIDADE
// ======================
export async function deletarNecessidade(req, res) {
  try {
    const { id } = req.params;

    // Busca necessidade
    const necResult = await pool.query(
      'SELECT id, ponto_id FROM necessidades WHERE id = $1',
      [id]
    );
    const necessidade = necResult.rows[0];

    if (!necessidade) {
      return res.status(404).json({ error: 'Necessidade não encontrada' });
    }

    // Busca ponto para verificar permissão
    const pontoResult = await pool.query(
      'SELECT user_id FROM pontos WHERE id = $1',
      [necessidade.ponto_id]
    );
    const ponto = pontoResult.rows[0];

    if (ponto.user_id !== req.user?.id && req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Você não pode apagar essa necessidade'
      });
    }

    // Deleta
    await pool.query('DELETE FROM necessidades WHERE id = $1', [id]);

    logger.info(`Necessidade ${id} deletada por usuário ${req.user?.id}`);
    res.json({ message: 'Necessidade deletada com sucesso' });

  } catch (err) {
    logger.error('Erro ao deletar necessidade:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}