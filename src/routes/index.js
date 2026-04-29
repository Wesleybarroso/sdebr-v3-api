// src/routes/index.js
import { Router } from 'express';

// ======================
// 📍 Controllers
// ======================
import {
  criarPonto,
  listarPontos,
  buscarPonto,
  atualizarPonto,
  deletarPonto
} from '../controllers/pontosController.js';

import {
  criarNecessidade,
  listarNecessidades,
  atualizarNecessidade,
  deletarNecessidade
} from '../controllers/necessidadesController.js';

import {
  registrarDoacao,
  listarDoacoes,
  deletarDoacao
} from '../controllers/doacoesController.js';

import {
  listarIPsBloqueados,
  desbloquearIP,
  listarSolicitacoes,
  aprovarPonto,
  rejeitarPonto,
  getDashboard,
  listarAuditoria,
  listarLogs,
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  deletarUsuario
} from '../controllers/adminController.js';

import {
  register,
  login,
  getMe,
  alterarSenha,
  // ✅ 2FA
  setup2FA,
  enable2FA,
  disable2FA,
  // ✅ RECUPERAÇÃO DE SENHA
  forgotPassword,
  resetPassword,
  verifyResetToken
} from '../controllers/authController.js';

// ✅ CONFIGURAÇÃO DE EMAIL
import {
  getEmailConfig,
  saveEmailConfig,
  testEmailConfig,
  deactivateEmailConfig
} from '../controllers/emailConfigController.js';

// ======================
// 🔒 Middlewares
// ======================
import { authMiddleware } from '../middleware/auth.js';
import { permit } from '../middleware/role.js';
import { verify2FA } from '../middleware/verify2FA.js';
import { checkSettingsAccess } from '../middleware/checkSettingsAccess.js';

// 🚫 Rate limit
import { doacaoLimiter } from '../middleware/rateLimit.js';

const router = Router();

// ======================
// 🌐 ROOT
// ======================
router.get('/', (req, res) => {
  res.json({
    status: 'online',
    app: 'SDEBR API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// ======================
// 👤 AUTH
// ======================
router.post('/register', register);
router.post('/login', login);
router.get('/me', authMiddleware, getMe);

// 🔐 ALTERAR SENHA (Protegido com 2FA)
router.put('/alterar-senha', authMiddleware, verify2FA, alterarSenha);

// 🔐 ROTAS DE 2FA (Configuração)
router.get('/auth/2fa/setup', authMiddleware, setup2FA);
router.post('/auth/2fa/enable', authMiddleware, enable2FA);
router.post('/auth/2fa/disable', authMiddleware, disable2FA);

// 🔐 RECUPERAÇÃO DE SENHA (Públicas - sem auth)
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/reset-password', resetPassword);
router.get('/auth/verify-reset-token', verifyResetToken);

// ======================
// 📍 PONTOS
// ======================
router.get('/pontos', listarPontos);
router.get('/pontos/:id', buscarPonto);
router.post('/pontos', authMiddleware, permit('admin'), criarPonto);
router.put('/pontos/:id', authMiddleware, permit('admin'), atualizarPonto);
router.delete('/pontos/:id', authMiddleware, permit('admin'), deletarPonto);

// ======================
// 📦 NECESSIDADES
// ======================
router.get('/necessidades', listarNecessidades);
router.post('/necessidades', authMiddleware, permit('ponto', 'admin'), criarNecessidade);
router.patch('/necessidades/:id', authMiddleware, permit('ponto', 'admin'), atualizarNecessidade);
router.delete('/necessidades/:id', authMiddleware, permit('ponto', 'admin'), deletarNecessidade);

// ======================
// 🤝 DOAÇÕES
// ======================
router.get('/doacoes', listarDoacoes);
router.post('/doacoes', authMiddleware, permit('user', 'admin'), doacaoLimiter, registrarDoacao);
router.delete('/doacoes/:id', authMiddleware, permit('admin'), deletarDoacao);

// ======================
// 👑 ADMIN
// ======================
router.get('/admin/dashboard', authMiddleware, permit('admin'), getDashboard);
router.get('/admin/ips', authMiddleware, permit('admin'), listarIPsBloqueados);
router.delete('/admin/ip/:ip', authMiddleware, permit('admin'), desbloquearIP);
router.get('/admin/solicitacoes', authMiddleware, permit('admin'), listarSolicitacoes);
router.patch('/admin/aprovar/:id', authMiddleware, permit('admin'), aprovarPonto);
router.patch('/admin/rejeitar/:id', authMiddleware, permit('admin'), rejeitarPonto);
router.get('/admin/auditoria', authMiddleware, permit('admin'), listarAuditoria);
router.get('/admin/logs', authMiddleware, permit('admin'), listarLogs);

// 👥 USUÁRIOS (Com proteções 2FA e controle de acesso)
router.get('/admin/usuarios', authMiddleware, permit('admin'), listarUsuarios);
router.post('/admin/usuarios', authMiddleware, permit('admin'), verify2FA, criarUsuario);
router.put('/admin/usuarios/:id', authMiddleware, permit('admin'), verify2FA, checkSettingsAccess, atualizarUsuario);
router.delete('/admin/usuarios/:id', authMiddleware, permit('admin'), verify2FA, deletarUsuario);

// 🔐 CONFIGURAÇÕES DO ADMIN
router.get('/admin/configuracoes', authMiddleware, permit('admin'), checkSettingsAccess, (req, res) => {
  res.json({ message: 'Acesso permitido às configurações' });
});

// 📧 CONFIGURAÇÃO DE EMAIL (Admin)
router.get('/admin/email-config', authMiddleware, permit('admin'), checkSettingsAccess, getEmailConfig);
router.post('/admin/email-config', authMiddleware, permit('admin'), checkSettingsAccess, saveEmailConfig);
router.post('/admin/email-config/test', authMiddleware, permit('admin'), checkSettingsAccess, testEmailConfig);
router.post('/admin/email-config/deactivate', authMiddleware, permit('admin'), checkSettingsAccess, deactivateEmailConfig);

export default router;