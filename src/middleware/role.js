import { logger } from '../config/logger.js';

const ROLES_VALIDAS = ['user', 'ponto', 'admin'];

// ======================
// 🛡️ CONTROLE DE PERMISSÃO
// ======================
export function permit(...roles) {
  // detecta erro de configuração em tempo de desenvolvimento
  const invalidas = roles.filter(r => !ROLES_VALIDAS.includes(r));
  if (invalidas.length > 0) {
    throw new Error(`[permit] Roles inválidas: ${invalidas.join(', ')}. Válidas: ${ROLES_VALIDAS.join(', ')}`);
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (!req.user.role) {
      return res.status(403).json({ error: 'Role de usuário não definida' });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(
        `Acesso negado: usuário ${req.user.id} (${req.user.role}) → requer [${roles.join(', ')}] | ${req.method} ${req.path}`
      );
      return res.status(403).json({
        error: 'Você não tem permissão para acessar este recurso'
      });
    }

    next();
  };
}