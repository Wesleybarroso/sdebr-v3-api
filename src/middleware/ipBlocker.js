import { connectDB } from '../database/db.js';
import { logger } from '../config/logger.js';

const BLOCK_TIME = parseInt(process.env.IP_BLOCK_TIME_MS) || 10 * 60 * 1000; // 10 min padrão

// cache local para reduzir queries ao banco
const cache = new Map();
const CACHE_TTL = 60_000; // 1 minuto

function normalizeIP(ip) {
  return ip?.replace('::ffff:', '') || 'unknown';
}

// ======================
// 🚫 BLOQUEAR IP (persiste no banco)
// ======================
export async function blockIP(ip, motivo = 'automático') {
  ip = normalizeIP(ip);

  try {
    const db = await connectDB();
    const expiresAt = new Date(Date.now() + BLOCK_TIME).toISOString();

    // upsert — se já existe, renova expiração e incrementa contador
    await db.run(
      `INSERT INTO ips_bloqueados (ip, motivo, bloqueios, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(ip) DO UPDATE SET
         expires_at = excluded.expires_at,
         motivo = excluded.motivo,
         bloqueios = bloqueios + 1`,
      [ip, motivo, expiresAt]
    );

    // invalida cache para forçar re-consulta
    cache.delete(ip);

    logger.warn(`IP bloqueado: ${ip} | motivo: ${motivo} | expira: ${expiresAt}`);
  } catch (err) {
    logger.error('Erro ao bloquear IP:', err);
  }
}

// ======================
// 🔓 DESBLOQUEAR IP
// ======================
export async function unblockIP(ip) {
  ip = normalizeIP(ip);
  try {
    const db = await connectDB();
    await db.run('DELETE FROM ips_bloqueados WHERE ip = ?', [ip]);
    cache.delete(ip);
    logger.info(`IP desbloqueado manualmente: ${ip}`);
  } catch (err) {
    logger.error('Erro ao desbloquear IP:', err);
  }
}

// ======================
// 🛡️ MIDDLEWARE DE BLOQUEIO
// ======================
export async function ipBlocker(req, res, next) {
  try {
    const ip = normalizeIP(req.ip);
    const now = Date.now();

    // checa cache primeiro (evita query a cada request)
    const cached = cache.get(ip);
    if (cached && now < cached.until) {
      if (cached.bloqueado) {
        return res.status(403).json({
          error: 'Seu acesso foi bloqueado temporariamente. Tente novamente mais tarde.'
        });
      }
      return next();
    }

    // consulta banco
    const db = await connectDB();
    const registro = await db.get(
      `SELECT ip, expires_at FROM ips_bloqueados
       WHERE ip = ? AND expires_at > datetime('now')`,
      [ip]
    );

    // atualiza cache
    cache.set(ip, { bloqueado: !!registro, until: now + CACHE_TTL });

    if (registro) {
      return res.status(403).json({
        error: 'Seu acesso foi bloqueado temporariamente. Tente novamente mais tarde.'
      });
    }

    next();
  } catch (err) {
    logger.error('Erro no ipBlocker:', err);
    next(); // em caso de erro, não bloqueia o request
  }
}