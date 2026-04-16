import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// 🤝 REGISTRAR DOAÇÃO
// ======================
export async function registrarDoacao(req, res) {
  const { ponto_id, tipo, quantidade } = req.body;
  const db = await connectDB();

  // 🔴 validação básica
  if (!ponto_id || !tipo || !quantidade) {
    return res.status(400).json({
      error: 'Todos os campos são obrigatórios'
    });
  }

  // ✅ Validação de quantidade positiva
  if (quantidade <= 0) {
    return res.status(400).json({
      error: 'Quantidade deve ser maior que zero'
    });
  }

  // 🔍 verifica se o ponto existe e está ativo
  const ponto = await db.get(
    'SELECT * FROM pontos WHERE id = ? AND ativo = 1',
    [ponto_id]
  );

  if (!ponto) {
    return res.status(404).json({
      error: 'Ponto não encontrado ou inativo'
    });
  }

  // 🔍 busca necessidade relacionada
  const necessidade = await db.get(
    'SELECT * FROM necessidades WHERE ponto_id = ? AND tipo = ? AND status = "precisando"',
    [ponto_id, tipo]
  );

  // 🚨 INICIA TRANSAÇÃO
  await db.run('BEGIN TRANSACTION');

  try {
    // 💾 salva doação
    const result = await db.run(
      'INSERT INTO doacoes (ponto_id, tipo, quantidade) VALUES (?, ?, ?)',
      [ponto_id, tipo, quantidade]
    );

    // 🔥 ATUALIZA NECESSIDADE (se existir)
    if (necessidade) {
      let restante = necessidade.quantidade_restante ?? necessidade.quantidade;
      restante = restante - quantidade;

      if (restante < 0) restante = 0;

      // ✅ CÁLCULO DE PORCENTAGEM SEGURO (evita divisão por zero)
      let porcentagem = 0;
      if (necessidade.quantidade > 0) {
        porcentagem = Math.floor(
          ((necessidade.quantidade - restante) / necessidade.quantidade) * 100
        );
      }

      // 🚦 urgência automática
      let urgencia = 'alta';
      if (porcentagem >= 100) urgencia = 'ok';
      else if (porcentagem >= 70) urgencia = 'baixa';
      else if (porcentagem >= 40) urgencia = 'media';

      // 🧠 status
      let status = 'precisando';
      if (restante === 0) status = 'ok';

      await db.run(
        `UPDATE necessidades 
         SET quantidade_restante = ?, 
             porcentagem = ?, 
             urgencia = ?, 
             status = ?, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [restante, porcentagem, urgencia, status, necessidade.id]
      );

      logger.info(`Doação ${result.lastID} atualizou necessidade ${necessidade.id}`);
    } else {
      logger.info(`Doação ${result.lastID} registrada sem necessidade correspondente`);
    }

    // ✅ CONFIRMA TRANSAÇÃO
    await db.run('COMMIT');

    res.json({
      message: 'Doação registrada com sucesso',
      doacao_id: result.lastID,
      necessidade_atualizada: !!necessidade
    });

  } catch (err) {
    // ❌ CANCELA TRANSAÇÃO EM CASO DE ERRO
    await db.run('ROLLBACK');
    logger.error('Erro ao registrar doação:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 📋 LISTAR DOAÇÕES
// ======================
export async function listarDoacoes(req, res) {
  try {
    const db = await connectDB();
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

    if (ponto_id) {
      query += ' AND d.ponto_id = ?';
      params.push(ponto_id);
    }

    query += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const data = await db.all(query, params);

    // Contagem total
    let countQuery = 'SELECT COUNT(*) as total FROM doacoes d WHERE 1=1';
    const countParams = [];
    if (ponto_id) {
      countQuery += ' AND d.ponto_id = ?';
      countParams.push(ponto_id);
    }
    const total = await db.get(countQuery, countParams);

    res.json({
      data,
      paginacao: {
        total: total.total,
        page: parseInt(page),
        limit: parseInt(limit),
        paginas: Math.ceil(total.total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar doações:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ❌ DELETAR DOAÇÃO
// ======================
export async function deletarDoacao(req, res) {
  const { id } = req.params;
  const db = await connectDB();

  try {
    const doacao = await db.get(
      'SELECT * FROM doacoes WHERE id = ?',
      [id]
    );

    if (!doacao) {
      return res.status(404).json({
        error: 'Doação não encontrada'
      });
    }

    // Verificar se a doação tem uma necessidade associada para restaurar
    const necessidade = await db.get(
      'SELECT * FROM necessidades WHERE ponto_id = ? AND tipo = ?',
      [doacao.ponto_id, doacao.tipo]
    );

    // 🚨 INICIA TRANSAÇÃO
    await db.run('BEGIN TRANSACTION');

    // Deleta a doação
    await db.run('DELETE FROM doacoes WHERE id = ?', [id]);

    // Se existir necessidade, restaura a quantidade
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

      await db.run(
        `UPDATE necessidades 
         SET quantidade_restante = ?, 
             porcentagem = ?, 
             urgencia = ?, 
             status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [novoRestante, novaPorcentagem, novaUrgencia, novoStatus, necessidade.id]
      );

      logger.info(`Doação ${id} deletada, necessidade ${necessidade.id} restaurada`);
    }

    await db.run('COMMIT');

    logger.info(`Doação ${id} deletada por usuário ${req.user?.id || 'sistema'}`);
    res.json({
      message: 'Doação deletada com sucesso'
    });

  } catch (err) {
    await db.run('ROLLBACK');
    logger.error('Erro ao deletar doação:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}