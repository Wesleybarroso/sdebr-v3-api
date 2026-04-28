// src/utils/hcaptcha.js
import axios from 'axios';

/**
 * Verifica o token do hCaptcha com a API oficial
 * @param {string} token - Token recebido do frontend
 * @param {string} remoteIP - IP do usuário (opcional)
 * @returns {Promise<Object>} - Resposta da API do hCaptcha
 */
export const verifyToken = async (token, remoteIP = null) => {
  try {
    const secret = process.env.HCAPTCHA_SECRET;
    
    if (!secret) {
      console.error('❌ HCAPTCHA_SECRET não configurada');
      return { success: false, 'error-codes': ['missing-secret'] };
    }

    const params = new URLSearchParams({
      secret,
      response: token,
    });
    
    if (remoteIP) {
      params.append('remoteip', remoteIP);
    }

    const response = await axios.post(
      'https://api.hcaptcha.com/siteverify',
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 5000
      }
    );

    return response.data;
    
  } catch (error) {
    console.error('❌ Erro ao verificar hCaptcha:', error.message);
    
    if (error.response) {
      return { 
        success: false, 
        'error-codes': [error.response.data?.error || 'verification-failed'] 
      };
    }
    
    return { success: false, 'error-codes': ['connection-error'] };
  }
};