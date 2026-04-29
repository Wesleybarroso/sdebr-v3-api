// src/controllers/authController.js
import pool from '../database/db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';  // ✅ NOVO: Para gerar tokens seguros
import { JWT_CONFIG } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import { registrarAuditoria } from '../utils/auditoria.js';
import { verifyToken } from '../utils/hcaptcha.js';
import { hashToken } from '../utils/encryption.js';  // ✅ NOVO: Para hash de tokens
import { emailService } from '../services/emailService.js';  // ✅ NOVO: Para envio de emails
// ✅ IMPORTS PARA 2FA
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;

// ======================
// 📝 REGISTER
// ======================
export async function register(req, res) {
  try {
    const { nome, email, senha, quer_ser_ponto, telefone, endereco, 'h-captcha-response': captchaToken } = req.body;
    
    if (process.env.NODE_ENV === 'production') {
      if (!captchaToken) {
        return res.status(400).json({ error: 'Verificação de segurança obrigatória', code: 'MISSING_CAPTCHA' });
      }
      const hcaptchaResult = await verifyToken(captchaToken, req.ip);
      if (!hcaptchaResult.success) {
        logger.warn('⚠️ hCaptcha falhou no registro:', hcaptchaResult['error-codes']);
        return res.status(400).json({ error: 'Verificação de segurança falhou', details: hcaptchaResult['error-codes'], code: 'CAPTCHA_FAILED' });
      }
    }
    
    const checkResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const status = quer_ser_ponto ? 'pendente' : 'ativo';
    const role = 'user';

    const insertResult = await pool.query(
      `INSERT INTO usuarios (nome, email, senha, telefone, endereco, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
      [nome, email, senhaHash, telefone, endereco, role, status]
    );

    const novoUsuarioId = insertResult.rows[0].id;

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
    const { email, senha, 'h-captcha-response': captchaToken } = req.body;
    
    if (process.env.NODE_ENV === 'production') {
      if (!captchaToken) {
        return res.status(400).json({ error: 'Verificação de segurança obrigatória', code: 'MISSING_CAPTCHA' });
      }
      const hcaptchaResult = await verifyToken(captchaToken, req.ip);
      if (!hcaptchaResult.success) {
        logger.warn('⚠️ hCaptcha falhou no login:', hcaptchaResult['error-codes']);
        return res.status(400).json({ error: 'Verificação de segurança falhou', details: hcaptchaResult['error-codes'], code: 'CAPTCHA_FAILED' });
      }
    }
    
    const result = await pool.query(
      'SELECT id, nome, email, senha, role, status, telefone, endereco FROM usuarios WHERE email = $1',
      [email]
    );

    const user = result.rows[0];
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

    await pool.query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [user.id]);

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

    const result = await pool.query('SELECT id, senha FROM usuarios WHERE id = $1', [req.user.id]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const senhaCorreta = await bcrypt.compare(senha_atual, user.senha);
    if (!senhaCorreta) {
      return res.status(400).json({ error: 'Senha atual incorreta' });
    }

    const novaHash = await bcrypt.hash(nova_senha, SALT_ROUNDS);
    
    await pool.query('UPDATE usuarios SET senha = $1, updated_at = NOW() WHERE id = $2', [novaHash, req.user.id]);

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

// ============================================================================
// 🔐 FUNÇÕES DE 2FA (AUTENTICAÇÃO DE DOIS FATORES)
// ============================================================================

export async function setup2FA(req, res) {
  try {
    const user = req.user;
    const secret = speakeasy.generateSecret({ name: `SDEBR (${user.email})`, issuer: 'SDEBR' });

    await pool.query('UPDATE usuarios SET totp_secret = $1 WHERE id = $2', [secret.base32, user.id]);
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    logger.info(`2FA setup iniciado para usuário ${user.id}`);

    res.json({
      message: 'Escaneie o QR Code no Google Authenticator',
      secret: secret.base32,
      qrCode: qrCodeUrl,
      otpauth_url: secret.otpauth_url
    });

  } catch (err) {
    logger.error('Erro ao configurar 2FA:', err.message);
    res.status(500).json({ error: 'Erro ao gerar configuração do 2FA' });
  }
}

export async function enable2FA(req, res) {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Código de 6 dígitos é obrigatório' });
    }

    const result = await pool.query('SELECT totp_secret, totp_enabled FROM usuarios WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!user.totp_secret) return res.status(400).json({ error: 'Gere o QR Code primeiro em GET /auth/2fa/setup' });
    if (user.totp_enabled) return res.status(400).json({ error: '2FA já está ativado para esta conta' });

    const isValid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!isValid) {
      logger.warn(`Tentativa de ativação 2FA com código inválido para usuário ${userId}`);
      return res.status(400).json({ error: 'Código inválido. Verifique o horário do seu dispositivo e tente novamente.' });
    }

    await pool.query('UPDATE usuarios SET totp_enabled = TRUE WHERE id = $1', [userId]);

    await registrarAuditoria({
      usuario_id: userId,
      acao: '2FA_ATIVADO',
      entidade: 'usuarios',
      entidade_id: userId,
      ip: req.ip
    });

    logger.info(`2FA ativado com sucesso para usuário ${userId}`);
    res.json({ message: '2FA ativado com sucesso! Suas ações administrativas agora estão protegidas.' });

  } catch (err) {
    logger.error('Erro ao ativar 2FA:', err.message);
    res.status(500).json({ error: 'Erro interno ao ativar 2FA' });
  }
}

export async function disable2FA(req, res) {
  try {
    const { senha_atual, otp_code } = req.body;
    const userId = req.user.id;

    if (!senha_atual) return res.status(400).json({ error: 'Senha atual é obrigatória para desativar o 2FA' });
    if (!otp_code || otp_code.length !== 6) return res.status(400).json({ error: 'Código de 6 dígitos do 2FA é obrigatório' });

    const result = await pool.query('SELECT senha, totp_secret, totp_enabled FROM usuarios WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!user.totp_enabled) return res.status(400).json({ error: '2FA não está ativado para esta conta' });

    const validPass = await bcrypt.compare(senha_atual, user.senha);
    if (!validPass) {
      logger.warn(`Tentativa de desativar 2FA com senha incorreta para usuário ${userId}`);
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: otp_code,
      window: 2
    });

    if (!isValid) {
      logger.warn(`Tentativa de desativar 2FA com código inválido para usuário ${userId}`);
      return res.status(401).json({ error: 'Código 2FA inválido. Para desativar, é necessário fornecer um código válido atual.' });
    }

    await pool.query('UPDATE usuarios SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1', [userId]);

    await registrarAuditoria({
      usuario_id: userId,
      acao: '2FA_DESATIVADO',
      entidade: 'usuarios',
      entidade_id: userId,
      ip: req.ip
    });

    logger.info(`2FA desativado com sucesso para usuário ${userId}`);
    res.json({ message: '2FA desativado com sucesso.' });

  } catch (err) {
    logger.error('Erro ao desativar 2FA:', err.message);
    res.status(500).json({ error: 'Erro interno ao desativar 2FA' });
  }
}

// ============================================================================
// 🔐 RECUPERAÇÃO DE SENHA (FORGOT / RESET PASSWORD) - ✅ NOVAS FUNÇÕES
// ============================================================================

// 🔹 Esqueci minha senha - Envia email com link de recuperação
export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    
    if (!email) return res.status(400).json({ error: 'Email é obrigatório' });
    
    const userResult = await pool.query(
      'SELECT id, nome, email, status FROM usuarios WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    
    const successMessage = 'Se este email estiver cadastrado, você receberá instruções para recuperar sua senha.';
    
    if (!userResult.rows[0] || userResult.rows[0].status !== 'ativo') {
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.json({ message: successMessage });
    }
    
    const user = userResult.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const resetLink = `${frontendUrl}/recuperar-senha?token=${token}&email=${encodeURIComponent(email)}`;
    
    await emailService.sendMail({
      to: user.email,
      subject: '🔐 Recuperação de Senha - SDEBR',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e293b;">Olá, ${user.nome}!</h2>
          <p style="color:#475569;">Você solicitou recuperação de senha no SDEBR.</p>
          <div style="background:#f1f5f9;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #7c3aed;">
            <a href="${resetLink}" style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">🔐 Recuperar Senha</a>
          </div>
          <p style="color:#64748b;font-size:14px;">⏰ Este link expira em 1 hora.<br>🔐 Se não solicitou, ignore este email.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;">
          <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">Equipe SDEBR • ${frontendUrl}</p>
        </div>
      `
    });
    
    await registrarAuditoria({
      usuario_id: user.id,
      acao: 'FORGOT_PASSWORD',
      entidade: 'usuarios',
      entidade_id: user.id,
      ip: req.ip
    });
    
    logger.info(`Email de recuperação enviado para ${email}`);
    res.json({ message: successMessage });
    
  } catch (err) {
    logger.error('Erro no forgotPassword:', err.message);
    res.status(500).json({ error: 'Não foi possível processar sua solicitação. Tente novamente mais tarde.' });
  }
}

// 🔹 Redefinir senha - Valida token e atualiza senha
export async function resetPassword(req, res) {
  try {
    const { token, nova_senha } = req.body;
    
    if (!token || !nova_senha) return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    if (nova_senha.length < 6) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
    
    const tokenHash = hashToken(token);
    
    const result = await pool.query(
      `SELECT prt.user_id, u.email FROM password_reset_tokens prt
       JOIN usuarios u ON prt.user_id = u.id
       WHERE prt.token = $1 AND prt.used = FALSE AND prt.expires_at > NOW()`,
      [tokenHash]
    );
    
    if (!result.rows[0]) {
      return res.status(400).json({ error: 'Token inválido ou expirado. Solicite uma nova recuperação de senha.' });
    }
    
    const { user_id, email } = result.rows[0];
    const hashedPassword = await bcrypt.hash(nova_senha, SALT_ROUNDS);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE usuarios SET senha = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, user_id]);
      await client.query('UPDATE password_reset_tokens SET used = TRUE WHERE token = $1', [tokenHash]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
    await registrarAuditoria({
      usuario_id: user_id,
      acao: 'PASSWORD_RESET',
      entidade: 'usuarios',
      entidade_id: user_id,
      ip: req.ip
    });
    
    logger.info(`Senha redefinida com sucesso para ${email}`);
    res.json({ message: 'Senha alterada com sucesso! Você já pode fazer login com sua nova senha.' });
    
  } catch (err) {
    logger.error('Erro no resetPassword:', err.message);
    res.status(500).json({ error: 'Erro ao redefinir senha. Tente novamente.' });
  }
}

// 🔹 Verificar token (opcional, para melhor UX no frontend)
export async function verifyResetToken(req, res) {
  try {
    const { token } = req.query;
    
    if (!token) return res.status(400).json({ error: 'Token é obrigatório' });
    
    const tokenHash = hashToken(token);
    
    const result = await pool.query(
      `SELECT prt.user_id, u.nome, u.email FROM password_reset_tokens prt
       JOIN usuarios u ON prt.user_id = u.id
       WHERE prt.token = $1 AND prt.used = FALSE AND prt.expires_at > NOW()`,
      [tokenHash]
    );
    
    if (!result.rows[0]) {
      return res.status(400).json({ valid: false, error: 'Token inválido ou expirado' });
    }
    
    res.json({ 
      valid: true, 
      user: {
        nome: result.rows[0].nome,
        email: result.rows[0].email
      }
    });
    
  } catch (err) {
    logger.error('Erro ao verificar token:', err.message);
    res.status(500).json({ error: 'Erro ao verificar token' });
  }
}