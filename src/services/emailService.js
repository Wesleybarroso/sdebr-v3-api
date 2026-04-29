// src/services/emailService.js
import pool from '../database/db.js';
import { decrypt } from '../utils/encryption.js';
import { logger } from '../config/logger.js';

// Provedores suportados
const providers = {
  smtp: async (config, mailOptions) => {
    const nodemailer = await import('nodemailer');
    
    const transporter = nodemailer.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });
    
    return await transporter.sendMail(mailOptions);
  },
  
  resend: async (config, mailOptions) => {
    const { Resend } = await import('resend');
    const resend = new Resend(config.apiKey);
    
    return await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text
    });
  },
  
  sendgrid: async (config, mailOptions) => {
    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(config.apiKey);
    
    await sgMail.default.send({
      to: mailOptions.to,
      from: `${config.fromName} <${config.fromEmail}>`,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text
    });
  }
};

export const emailService = {
  // Busca config ativa e descriptografa
  async getActiveConfig() {
    const result = await pool.query(
      `SELECT * FROM email_config WHERE is_active = TRUE LIMIT 1`
    );
    
    if (!result.rows[0]) return null;
    
    const config = result.rows[0];
    const credentials = decrypt({
      iv: config.credentials_encrypted.iv,
      authTag: config.credentials_encrypted.authTag,
      encrypted: config.credentials_encrypted.encrypted
    });
    
    return { ...config, ...credentials };
  },
  
  // Envia email usando o provedor configurado
  async sendMail({ to, subject, html, text, fromName, fromEmail, replyTo }) {
    const config = await this.getActiveConfig();
    
    if (!config) {
      throw new Error('Nenhuma configuração de email ativa encontrada');
    }
    
    const providerFn = providers[config.provider];
    if (!providerFn) {
      throw new Error(`Provedor de email não suportado: ${config.provider}`);
    }
    
    const mailOptions = {
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]*>/g, ''),
      fromName: fromName || config.from_name,
      fromEmail: fromEmail || config.from_email,
      replyTo: replyTo || config.reply_to
    };
    
    try {
      const result = await providerFn(config, mailOptions);
      logger.info(`Email enviado para ${to}: ${subject}`);
      return { success: true, messageId: result?.messageId || result?.id };
    } catch (error) {
      logger.error(`Erro ao enviar email para ${to}:`, error.message);
      throw new Error(`Falha ao enviar email: ${error.message}`);
    }
  },
  
  // Testa a configuração de email
  async testConfig(configData) {
    // Descriptografa para teste
    const credentials = decrypt(configData.credentials_encrypted);
    const fullConfig = { ...configData, ...credentials };
    
    const providerFn = providers[fullConfig.provider];
    if (!providerFn) throw new Error('Provedor não suportado');
    
    // Email de teste
    await providerFn(fullConfig, {
      to: fullConfig.from_email,
      subject: '✅ Teste de Configuração de Email - SDEBR',
      html: `
        <h3>Teste de Email Bem-Sucedido!</h3>
        <p>Sua configuração de email no SDEBR está funcionando corretamente.</p>
        <p><strong>Provedor:</strong> ${fullConfig.provider}</p>
        <p><strong>Enviado em:</strong> ${new Date().toLocaleString('pt-BR')}</p>
      `
    });
    
    return { success: true, message: 'Email de teste enviado com sucesso!' };
  }
};