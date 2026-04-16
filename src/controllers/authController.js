import { connectDB } from '../database/db.js';
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
    const { nome, email, senha, quer_ser_ponto } = req.body;
    // validação já feita pelo middleware validate(registerSchema)

    const db = await connectDB();

    const userExiste = await db.get(
      'SELECT id FROM usuarios WHERE email = ?',
      [email]
    );

    if (userExiste) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

    const status = quer_ser_ponto ? 'pendente' : 'ativo';
    const role = 'user';

    const result = await db.run(
      'INSERT INTO usuarios (nome, email, senha, role, status) VALUES (?, ?, ?, ?, ?)',
      [nome, email, senhaHash, role, status]
    );

    await registrarAuditoria({
      usuario_id: result.lastID,
      acao: 'REGISTRO',
      entidade: 'usuarios',
      entidade_id: result.lastID,
      ip: req.ip
    });

    logger.info(`Novo usuário registrado: ${email} (status: ${status})`);

    res.status(201).json({
      message: quer_ser_ponto
        ? 'Cadastro realizado! Aguarde aprovação para se tornar um ponto de coleta.'
        : 'Usuário cadastrado com sucesso'
    });

  } catch (err) {
    logger.error('Erro no register:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔐 LOGIN
// ======================
export async function login(req, res) {
  try {
    const { email, senha } = req.body;
    // validação já feita pelo middleware validate(loginSchema)

    const db = await connectDB();

    const user = await db.get(
      'SELECT id, nome, email, senha, role, status FROM usuarios WHERE email = ?',
      [email]
    );

    // timing-safe: sempre compara mesmo sem usuário (evita timing attack)
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

    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_CONFIG.secret,
      { expiresIn: JWT_CONFIG.expiresIn, algorithm: JWT_CONFIG.algorithm }
    );

    // atualiza último login
    await db.run(
      'UPDATE usuarios SET ultimo_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

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
        role: user.role
      }
    });

  } catch (err) {
    logger.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 👤 PERFIL DO USUÁRIO LOGADO
// ======================
export async function getMe(req, res) {
  try {
    const db = await connectDB();
    const user = await db.get(
      'SELECT id, nome, email, role, status, ultimo_login, created_at FROM usuarios WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(user);
  } catch (err) {
    logger.error('Erro no getMe:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔑 ALTERAR SENHA
// ======================
export async function alterarSenha(req, res) {
  try {
    const { senha_atual, nova_senha } = req.body;
    // validação já feita pelo middleware validate(alterarSenhaSchema)

    const db = await connectDB();
    const user = await db.get(
      'SELECT id, senha FROM usuarios WHERE id = ?',
      [req.user.id]
    );

    const senhaCorreta = await bcrypt.compare(senha_atual, user.senha);
    if (!senhaCorreta) {
      return res.status(400).json({ error: 'Senha atual incorreta' });
    }

    const novaHash = await bcrypt.hash(nova_senha, SALT_ROUNDS);
    await db.run(
      'UPDATE usuarios SET senha = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [novaHash, req.user.id]
    );

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
    logger.error('Erro ao alterar senha:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}