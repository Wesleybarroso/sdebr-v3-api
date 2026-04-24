// src/controllers/authController.js
import pool from '../database/db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { JWT_CONFIG } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;

// ======================
// 📝 REGISTER
// ======================
export async function register(req, res) {
  try {
    const { nome, email, senha, quer_ser_ponto, telefone, endereco } = req.body;

    // ✅ PostgreSQL: usa pool.query() com $1, $2
    const checkResult = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const status = quer_ser_ponto ? 'pendente' : 'ativo';
    const role = 'user';

    // ✅ Usa RETURNING para pegar o ID do novo usuário
    const insertResult = await pool.query(
      `INSERT INTO usuarios (nome, email, senha, telefone, endereco, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id`,
      [nome, email, senhaHash, telefone, endereco, role, status]
    );

    const novoUsuarioId = insertResult.rows[0].id;

    // Auditoria
    await registrarAuditoria({
      usuario_id: novoUsuarioId,
      acao: 'REGISTRO',
      entidade: 'usuarios',
      entidade_id: novoUsuarioId,
      ip: req.ip
    });

    logger.info(`Novo usuário registrado: ${email} (status: ${status})`);

    res.status(201).json({
      message: quer_ser_ponto
        ? 'Cadastro realizado! Aguarde aprovação para se tornar um ponto de coleta.'
        : 'Usuário cadastrado com sucesso'
    });

  } catch (err) {
    logger.error('Erro no register:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔐 LOGIN
// ======================
export async function login(req, res) {
  try {
    const { email, senha } = req.body;

    // ✅ Busca usuário com pool.query()
    const result = await pool.query(
      'SELECT id, nome, email, senha, role, status, telefone, endereco FROM usuarios WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    // Timing-safe: sempre compara mesmo sem usuário
    const senhaFake = '$2b$12$invalido.hash.para.timing.seguro.xxxxxxxxxx';
    const senhaValida = await bcrypt.compare(senha, user?.senha || senhaFake);

    if (!user || !senhaValida) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (user.status === 'pendente') {
      return res.status(403).json({ error: 'Seu cadastro como ponto ainda está em análise' });
    }

    if (user.status === 'rejeitado') {
      return res.status(403).json({ error: 'Seu cadastro não foi aprovado' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ error: 'Conta inativa. Entre em contato com o suporte.' });
    }

    // Gera token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_CONFIG.secret,
      { expiresIn: JWT_CONFIG.expiresIn, algorithm: JWT_CONFIG.algorithm }
    );

    // ✅ Atualiza último login
    await pool.query(
      'UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Auditoria
    await registrarAuditoria({
      usuario_id: user.id,
      acao: 'LOGIN',
      entidade: 'usuarios',
      entidade_id: user.id,
      ip: req.ip
    });

    logger.info(`Login: usuário ${user.id} (${user.role})`);

    res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        telefone: user.telefone,
        endereco: user.endereco
      }
    });

  } catch (err) {
    logger.error('Erro no login:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 👤 PERFIL DO USUÁRIO LOGADO
// ======================
export async function getMe(req, res) {
  try {
    // ✅ Query simples com pool.query()
    const result = await pool.query(
      'SELECT id, nome, email, role, status, telefone, endereco, ultimo_login, created_at FROM usuarios WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(user);

  } catch (err) {
    logger.error('Erro no getMe:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔑 ALTERAR SENHA
// ======================
export async function alterarSenha(req, res) {
  try {
    const { senha_atual, nova_senha } = req.body;

    // ✅ Busca senha atual
    const result = await pool.query(
      'SELECT id, senha FROM usuarios WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const senhaCorreta = await bcrypt.compare(senha_atual, user.senha);
    if (!senhaCorreta) {
      return res.status(400).json({ error: 'Senha atual incorreta' });
    }

    const novaHash = await bcrypt.hash(nova_senha, SALT_ROUNDS);
    
    // ✅ Atualiza senha
    await pool.query(
      'UPDATE usuarios SET senha = $1, updated_at = NOW() WHERE id = $2',
      [novaHash, req.user.id]
    );

    // Auditoria
    await registrarAuditoria({
      usuario_id: req.user.id,
      acao: 'ALTERAR_SENHA',
      entidade: 'usuarios',
      entidade_id: req.user.id,
      ip: req.ip
    });

    logger.info(`Senha alterada: usuário ${req.user.id}`);
    res.json({ message: 'Senha alterada com sucesso' });

  } catch (err) {
    logger.error('Erro ao alterar senha:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}