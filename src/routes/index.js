import { Router } from 'express';

// ======================
// 📍 Controllers
// ======================
import {
  criarPonto,
  listarPontos,
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
  listarUsuarios
} from '../controllers/adminController.js';

import {
  register,
  login,
  getMe,
  alterarSenha
} from '../controllers/authController.js';

// ======================
// 🔒 Middlewares
// ======================
import { authMiddleware } from '../middleware/auth.js';
import { permit } from '../middleware/role.js';

// 🚫 Rate limit
import { doacaoLimiter } from '../middleware/rateLimit.js';

const router = Router();

// ======================
// 🌐 ROOT
// ======================
router.get('/', (req, res) => {
  res.json({ message: 'SDEBR API funcionando 🚀' });
});

// ======================
// 👤 AUTH
// ======================
router.post('/register', register);
router.post('/login', login);
router.get('/me', authMiddleware, getMe);
router.put('/alterar-senha', authMiddleware, alterarSenha);

// ======================
// 📍 PONTOS
// ======================
router.get('/pontos', listarPontos);
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
router.get('/admin/usuarios', authMiddleware, permit('admin'), listarUsuarios);

export default router;