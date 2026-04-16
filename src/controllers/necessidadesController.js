import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// ➕ CRIAR NECESSIDADE
// ======================
export async function criarNecessidade(req, res) {
  try {
    const { ponto_id, tipo, quantidade, urgencia, status } = req.body;
    const db = await connectDB();

    // Verificar se ponto existe e está ativo
    const ponto = await db.get(
      'SELECT * FROM pontos WHERE id = ? AND ativo = 1',
      [ponto_id]
    );

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado ou inativo' });
    }

    if (ponto.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Você não pode adicionar necessidade neste ponto'
      });
    }

    // Validação de segurança
    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });
    }

    if (!tipo || tipo.trim() === '') {
      return res.status(400).json({ error: 'Tipo da necessidade é obrigatório' });
    }

    const result = await db.run(
      `INSERT INTO necessidades 
       (ponto_id, tipo, quantidade, quantidade_restante, porcentagem, urgencia, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ponto_id,
        tipo.trim(),
        quantidade,
        quantidade,
        0,
        urgencia || 'media',
        status || 'precisando'
      ]
    );

    logger.info(`Necessidade ${result.lastID} criada no ponto ${ponto_id}`);
    res.status(201).json({ 
      message: 'Necessidade cadastrada com sucesso',
      id: result.lastID 
    });

  } catch (err) {
    logger.error('Erro ao criar necessidade:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LISTAR NECESSIDADES
// ======================
export async function listarNecessidades(req, res) {
  try {
    const db = await connectDB();

    const data = await db.all(`
      SELECT 
        n.*, 
        p.nome as ponto_nome, 
        p.cidade,
        (n.quantidade - n.quantidade_restante) AS doado,
        ROUND(CAST((n.quantidade - n.quantidade_restante) AS FLOAT) / NULLIF(n.quantidade, 0) * 100, 1) AS percentual_doado
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

    res.json(data);

  } catch (err) {
    logger.error('Erro ao listar necessidades:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔍 BUSCAR NECESSIDADE POR ID
// ======================
export async function buscarNecessidade(req, res) {
  try {
    const db = await connectDB();

    const necessidade = await db.get(
      `SELECT n.*, p.nome as ponto_nome, p.cidade, p.estado,
       (n.quantidade - n.quantidade_restante) AS doado
       FROM necessidades n
       JOIN pontos p ON n.ponto_id = p.id
       WHERE n.id = ?`,
      [req.params.id]
    );

    if (!necessidade) {
      return res.status(404).json({ error: 'Necessidade não encontrada' });
    }

    res.json(necessidade);

  } catch (err) {
    logger.error('Erro ao buscar necessidade:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ✏️ ATUALIZAR NECESSIDADE
// ======================
export async function atualizarNecessidade(req, res) {
  try {
    const db = await connectDB();
    const { id } = req.params;
    const { status, urgencia, quantidade } = req.body;

    const necessidade = await db.get(
      'SELECT * FROM necessidades WHERE id = ?',
      [id]
    );

    if (!necessidade) {
      return res.status(404).json({ error: 'Necessidade não encontrada' });
    }

    const ponto = await db.get(
      'SELECT * FROM pontos WHERE id = ?',
      [necessidade.ponto_id]
    );

    if (ponto.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Você não pode alterar essa necessidade'
      });
    }

    // Valores padrão (mantém os atuais se não enviar)
    let novaQuantidade = necessidade.quantidade;
    let novoRestante = necessidade.quantidade_restante;

    if (quantidade && quantidade !== necessidade.quantidade) {
      novaQuantidade = quantidade;
      // Se a nova quantidade for menor que o restante atual, ajusta
      novoRestante = Math.min(necessidade.quantidade_restante, novaQuantidade);
    }

    // ✅ CÁLCULO SEGURO - Evita divisão por zero!
    let porcentagem = 0;
    if (novaQuantidade > 0) {
      porcentagem = Math.floor(((novaQuantidade - novoRestante) / novaQuantidade) * 100);
    }

    // Usa COALESCE para manter valor atual se não enviar
    await db.run(
      `UPDATE necessidades 
       SET quantidade = COALESCE(?, quantidade),
           quantidade_restante = COALESCE(?, quantidade_restante),
           porcentagem = COALESCE(?, porcentagem),
           urgencia = COALESCE(?, urgencia),
           status = COALESCE(?, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [quantidade, novoRestante, porcentagem, urgencia, status, id]
    );

    logger.info(`Necessidade ${id} atualizada por usuário ${req.user.id}`);
    res.json({ message: 'Necessidade atualizada com sucesso' });

  } catch (err) {
    logger.error('Erro ao atualizar necessidade:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ❌ DELETAR NECESSIDADE
// ======================
export async function deletarNecessidade(req, res) {
  try {
    const db = await connectDB();
    const { id } = req.params;

    const necessidade = await db.get(
      'SELECT * FROM necessidades WHERE id = ?',
      [id]
    );

    if (!necessidade) {
      return res.status(404).json({ error: 'Necessidade não encontrada' });
    }

    const ponto = await db.get(
      'SELECT * FROM pontos WHERE id = ?',
      [necessidade.ponto_id]
    );

    if (ponto.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Você não pode apagar essa necessidade'
      });
    }

    await db.run('DELETE FROM necessidades WHERE id = ?', [id]);

    logger.info(`Necessidade ${id} deletada por usuário ${req.user.id}`);
    res.json({ message: 'Necessidade deletada com sucesso' });

  } catch (err) {
    logger.error('Erro ao deletar necessidade:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}