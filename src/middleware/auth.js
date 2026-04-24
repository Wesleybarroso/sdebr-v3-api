// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { JWT_CONFIG } from '../config/jwt.js';
import pool from '../database/db.js';
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

    // ✅ PostgreSQL: valida usuário com pool.query()
    const userResult = await pool.query(
      'SELECT id, nome, email, role, status, telefone, endereco FROM usuarios WHERE id = $1',
      [decoded.id]
    );

    const user = userResult.rows[0];  // ✅ Acessa .rows[0] no PostgreSQL

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ error: 'Conta inativa ou suspensa' });
    }

    req.user = user;
    next();

  } catch (err) {
    logger.error('Erro no authMiddleware:', err.message);
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
      // ✅ PostgreSQL: busca usuário com pool.query()
      const userResult = await pool.query(
        'SELECT id, nome, email, role, status, telefone, endereco FROM usuarios WHERE id = $1 AND status = $2',
        [decoded.id, 'ativo']
      );
      
      const user = userResult.rows[0];  // ✅ Acessa .rows[0]
      if (user) req.user = user;
    }
  } catch {
    // token inválido em auth opcional — ignora silenciosamente
  }
  next();
}