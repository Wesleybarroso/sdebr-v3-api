import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { blockIP } from './ipBlocker.js';

const GLOBAL_MAX = parseInt(process.env.RATE_LIMIT_GLOBAL) || 100;
const LOGIN_MAX  = parseInt(process.env.RATE_LIMIT_LOGIN)  || 10;
const DOACAO_MAX = parseInt(process.env.RATE_LIMIT_DOACAO) || 5;
const REGISTER_MAX = parseInt(process.env.RATE_LIMIT_REGISTER) || 5;

// ✅ Função keyGenerator que suporta IPv6 corretamente
const customKeyGenerator = (req) => {
    // Se usuário está logado, usa o ID do usuário como chave
    if (req.user?.id) {
        return `user:${req.user.id}`;
    }
    // Caso contrário, usa a função oficial para normalizar IP (IPv4 e IPv6)
    // ipKeyGenerator espera uma STRING (req.ip), não o objeto req
    return ipKeyGenerator(req.ip);
    
    // 💡 Opcional: usar subnet /64 para IPv6 (comum em ISPs residenciais)
    // return ipKeyGenerator(req.ip, 64);
};

const defaultOptions = {
  standardHeaders: true,  // envia headers RateLimit-* (RFC 6585)
  legacyHeaders: false,   // desativa headers X-RateLimit-* antigos
  keyGenerator: customKeyGenerator
};

// ======================
// 🌍 GLOBAL - Limite geral para todas as rotas
// ======================
export const globalLimiter = rateLimit({
  ...defaultOptions,
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: GLOBAL_MAX,
  handler: async (req, res) => {
    // Só bloqueia o IP se estiver muito além do limite (abuso real)
    const excess = (req.rateLimit?.current || 0) - GLOBAL_MAX;
    if (excess > 30) {
      await blockIP(req.ip, 'abuso de rate limit global');
    }
    return res.status(429).json({
      error: 'Muitas requisições. Tente novamente em alguns minutos.'
    });
  }
});

// ======================
// 🔐 LOGIN - Anti brute-force (somente falhas)
// ======================
export const loginLimiter = rateLimit({
  ...defaultOptions,
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: LOGIN_MAX,
  skipSuccessfulRequests: true, // conta apenas tentativas com erro
  handler: async (req, res) => {
    // Bloqueia IP imediatamente após excesso de tentativas
    await blockIP(req.ip, 'brute force — login');
    return res.status(429).json({
      error: 'Muitas tentativas de login. IP bloqueado temporariamente.'
    });
  }
});

// ======================
// 📝 REGISTRO - Anti spam de cadastros
// ======================
export const registerLimiter = rateLimit({
  ...defaultOptions,
  windowMs: 60 * 60 * 1000, // 1 hora
  max: REGISTER_MAX,
  handler: async (req, res) => {
    await blockIP(req.ip, 'spam de cadastro');
    return res.status(429).json({
      error: 'Muitos cadastros deste IP. Tente novamente mais tarde.'
    });
  }
});

// ======================
// 🤝 DOAÇÕES - Anti spam de transações
// ======================
export const doacaoLimiter = rateLimit({
  ...defaultOptions,
  windowMs: 60 * 1000, // 1 minuto (janela curta para transações)
  max: DOACAO_MAX,
  handler: async (req, res) => {
    await blockIP(req.ip, 'spam de doações');
    return res.status(429).json({
      error: 'Muitas doações em pouco tempo. Aguarde um momento e tente novamente.'
    });
  }
});