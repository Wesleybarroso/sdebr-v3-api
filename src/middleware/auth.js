import jwt from 'jsonwebtoken';
import { JWT_CONFIG } from '../config/jwt.js';
import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';

// ======================
// 🔒 AUTENTICAÇÃO JWT
// ======================
export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token não fornecido. Use o formato: Bearer <token>'
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_CONFIG.secret, {
        algorithms: [JWT_CONFIG.algorithm]
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Token inválido' });
      }
      return res.status(401).json({ error: 'Falha na verificação do token' });
    }

    if (!decoded.id || !decoded.role) {
      return res.status(401).json({ error: 'Token malformado' });
    }

    // valida usuário no banco (garante que não foi banido/deletado após emissão)
    const db = await connectDB();
    const user = await db.get(
      'SELECT id, nome, email, role, status FROM usuarios WHERE id = ?',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ error: 'Conta inativa ou suspensa' });
    }

    req.user = user;
    next();

  } catch (err) {
    logger.error('Erro no authMiddleware:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ======================
// 🔓 AUTH OPCIONAL
// (popula req.user se tiver token, mas não bloqueia sem ele)
// ======================
export async function authOpcional(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_CONFIG.secret, {
      algorithms: [JWT_CONFIG.algorithm]
    });

    if (decoded?.id) {
      const db = await connectDB();
      const user = await db.get(
        'SELECT id, nome, email, role, status FROM usuarios WHERE id = ? AND status = ?',
        [decoded.id, 'ativo']
      );
      if (user) req.user = user;
    }
  } catch {
    // token inválido em auth opcional — ignora silenciosamente
  }
  next();
}