import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';

// ======================
// ➕ CRIAR PONTO
// ======================
export async function criarPonto(req, res) {
  try {
    const { nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao } = req.body;
    // validação já feita pelo middleware validate(criarPontoSchema)

    const db = await connectDB();
    const MAX_PONTOS = parseInt(process.env.MAX_PONTOS_POR_USUARIO) || 2;

    const pontos = await db.all(
      'SELECT id, cidade FROM pontos WHERE user_id = ?',
      [req.user.id]
    );

    if (pontos.length >= MAX_PONTOS) {
      return res.status(400).json({ error: `Você já atingiu o limite de ${MAX_PONTOS} ponto(s) de coleta` });
    }

    if (pontos.length > 0 && pontos[0].cidade.toLowerCase() !== cidade.toLowerCase()) {
      return res.status(400).json({
        error: 'Todos os seus pontos devem ser na mesma cidade'
      });
    }

    const result = await db.run(
      `INSERT INTO pontos (nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, rua, numero, bairro, cidade, estado, cep, complemento, descricao, req.user.id]
    );

    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'CRIAR_PONTO',
      entidade: 'pontos',
      entidade_id: result.lastID,
      ip: req.ip
    });

    logger.info(`Ponto ${result.lastID} criado por usuário ${req.user.id}`);
    res.status(201).json({ id: result.lastID, message: 'Ponto de coleta criado com sucesso' });

  } catch (err) {
    logger.error('Erro ao criar ponto:', err);
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

    const db = await connectDB();

    let query = `
      SELECT p.id, p.nome, p.rua, p.numero, p.bairro, p.cidade, p.estado, p.cep,
             p.complemento, p.descricao, p.ativo, p.created_at,
             u.nome as responsavel
      FROM pontos p
      LEFT JOIN usuarios u ON p.user_id = u.id
      WHERE p.ativo = 1
    `;
    const params = [];

    if (cidade) { query += ' AND LOWER(p.cidade) = LOWER(?)'; params.push(cidade); }
    if (estado) { query += ' AND UPPER(p.estado) = UPPER(?)'; params.push(estado); }
    if (busca) { query += ' AND (LOWER(p.nome) LIKE LOWER(?) OR LOWER(p.bairro) LIKE LOWER(?))'; params.push(`%${busca}%`, `%${busca}%`); }

    const countQuery = query.replace(
      /SELECT.*?FROM pontos/s,
      'SELECT COUNT(*) as total FROM pontos'
    );
    const total = await db.get(countQuery, params);

    query += ' ORDER BY p.nome ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const pontos = await db.all(query, params);

    res.json({
      data: pontos,
      paginacao: {
        total: total.total,
        page,
        limit,
        paginas: Math.ceil(total.total / limit)
      }
    });

  } catch (err) {
    logger.error('Erro ao listar pontos:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔍 BUSCAR PONTO POR ID
// ======================
export async function buscarPonto(req, res) {
  try {
    const { id } = req.params;
    const db = await connectDB();

    const ponto = await db.get(
      `SELECT p.*, u.nome as responsavel, u.email as responsavel_email
       FROM pontos p
       LEFT JOIN usuarios u ON p.user_id = u.id
       WHERE p.id = ? AND p.ativo = 1`,
      [id]
    );

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado' });
    }

    // busca necessidades do ponto junto
    const necessidades = await db.all(
      `SELECT id, tipo, quantidade, quantidade_restante, porcentagem, urgencia, status
       FROM necessidades 
       WHERE ponto_id = ? AND status = 'precisando'
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

    res.json({ ...ponto, necessidades });

  } catch (err) {
    logger.error('Erro ao buscar ponto:', err);
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
    // validação já feita pelo middleware validate(atualizarPontoSchema)

    const db = await connectDB();

    const ponto = await db.get(
      'SELECT id, user_id FROM pontos WHERE id = ?',
      [id]
    );

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado' });
    }

    if (req.user.role !== 'admin' && ponto.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Você não tem permissão para editar este ponto' });
    }

    // COALESCE mantém o valor atual se o campo não for enviado
    await db.run(
      `UPDATE pontos SET
        nome        = COALESCE(?, nome),
        rua         = COALESCE(?, rua),
        numero      = COALESCE(?, numero),
        bairro      = COALESCE(?, bairro),
        cidade      = COALESCE(?, cidade),
        estado      = COALESCE(?, estado),
        cep         = COALESCE(?, cep),
        complemento = COALESCE(?, complemento),
        descricao   = COALESCE(?, descricao),
        updated_at  = CURRENT_TIMESTAMP
       WHERE id = ?`,
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
    logger.error('Erro ao atualizar ponto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// ❌ DELETAR PONTO
// ======================
export async function deletarPonto(req, res) {
  try {
    const { id } = req.params;
    const db = await connectDB();

    const ponto = await db.get(
      'SELECT id, user_id, nome FROM pontos WHERE id = ?',
      [id]
    );

    if (!ponto) {
      return res.status(404).json({ error: 'Ponto não encontrado' });
    }

    if (req.user.role !== 'admin' && ponto.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Você não tem permissão para deletar este ponto' });
    }

    // CASCADE no banco já deleta necessidades e doações vinculadas
    await db.run('DELETE FROM pontos WHERE id = ?', [id]);

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
    logger.error('Erro ao deletar ponto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔍 MEUS PONTOS
// ======================
export async function meusPontos(req, res) {
  try {
    const db = await connectDB();

    const pontos = await db.all(
      `SELECT p.*, 
        (SELECT COUNT(*) FROM necessidades n WHERE n.ponto_id = p.id AND n.status = 'precisando') as necessidades_pendentes,
        (SELECT COUNT(*) FROM necessidades n WHERE n.ponto_id = p.id) as total_necessidades,
        (SELECT COUNT(*) FROM doacoes d WHERE d.ponto_id = p.id) as total_doacoes
       FROM pontos p
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    res.json(pontos);

  } catch (err) {
    logger.error('Erro ao buscar meus pontos:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}