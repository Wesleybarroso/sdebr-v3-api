// src/middleware/verify2FA.js
import speakeasy from 'speakeasy';
import { logger } from '../config/logger.js';

export const verify2FA = (req, res, next) => {
  const user = req.user;

  if (!user?.totp_enabled) {
    return res.status(403).json({ 
      error: 'Ative o 2FA nas configurações antes de continuar.' 
    });
  }

  const otpCode = req.body.otp_code || req.headers['x-otp-code'];

  if (!otpCode) {
    return res.status(403).json({ 
      error: 'Código 2FA obrigatório.' 
    });
  }

  const isValid = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: otpCode,
    window: 2
  });

  if (!isValid) {
    return res.status(401).json({ error: 'Código 2FA inválido.' });
  }

  next();
};