// src/database/db.js
import pkg from 'pg';
const { Pool } = pkg;
import { logger } from '../config/logger.js';
import dotenv from 'dotenv';
dotenv.config();

// Pool de conexões (Melhor performance para VPS)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false, // Necessário para o Render/VPS
});

// Exporta o pool para ser usado nos controllers
export default pool;

// Função para inicializar/atualizar as tabelas
export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // ========================================================================
    // 🔧 MIGRAÇÕES: Atualiza tabelas existentes (para bancos já criados)
    // ========================================================================
    
    // 🔐 Adiciona colunas de 2FA e controle de acesso na tabela usuarios
    await client.query(`
      ALTER TABLE usuarios 
      ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255),
      ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS can_access_settings BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
    `);
    
    // 🔐 Garante que a coluna endereco seja JSONB (migração de TEXT)
    await client.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'usuarios' AND column_name = 'endereco' AND data_type = 'text'
        ) THEN
          ALTER TABLE usuarios ALTER COLUMN endereco TYPE JSONB USING endereco::jsonb;
        END IF;
      END $$;
    `);
    
    // 📋 Garante que a coluna detalhes da auditoria seja JSONB
    await client.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'auditoria' AND column_name = 'detalhes' AND data_type = 'text'
        ) THEN
          ALTER TABLE auditoria ALTER COLUMN detalhes TYPE JSONB USING detalhes::jsonb;
        END IF;
      END $$;
    `);
    
    // ========================================================================
    // 🆕 CRIAÇÃO DE TABELAS (para bancos novos)
    // ========================================================================
    
    await client.query(`
      -- 👤 USUÁRIOS
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        telefone TEXT,
        endereco JSONB,
        role TEXT DEFAULT 'user' CHECK(role IN ('user', 'ponto', 'admin', 'superadmin')),
        status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'pendente', 'rejeitado', 'inativo', 'suspenso')),
        
        -- 🔐 CAMPOS DE 2FA
        totp_secret VARCHAR(255),
        totp_enabled BOOLEAN DEFAULT FALSE,
        
        -- 🔐 CONTROLE DE ACESSO
        can_access_settings BOOLEAN DEFAULT TRUE,
        created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        
        ultimo_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- 📧 CONFIGURAÇÃO DE EMAIL (para recuperação de senha)
      CREATE TABLE IF NOT EXISTS email_config (
        id SERIAL PRIMARY KEY,
        configured_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        provider TEXT DEFAULT 'smtp' CHECK(provider IN ('smtp', 'resend', 'sendgrid', 'mailgun')),
        credentials_encrypted JSONB NOT NULL,
        from_name TEXT DEFAULT 'SDEBR',
        from_email TEXT NOT NULL,
        reply_to TEXT,
        is_active BOOLEAN DEFAULT FALSE,
        last_tested_at TIMESTAMPTZ,
        test_status TEXT CHECK(test_status IN ('success', 'failed')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- 🔐 TOKENS DE RECUPERAÇÃO DE SENHA
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- 📍 PONTOS DE COLETA
      CREATE TABLE IF NOT EXISTS pontos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        rua TEXT,
        numero TEXT,
        bairro TEXT,
        cidade TEXT,
        estado TEXT,
        cep TEXT,
        complemento TEXT,
        descricao TEXT,
        ativo BOOLEAN DEFAULT TRUE,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- 📦 NECESSIDADES
      CREATE TABLE IF NOT EXISTS necessidades (
        id SERIAL PRIMARY KEY,
        ponto_id INTEGER REFERENCES pontos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        quantidade INTEGER NOT NULL,
        quantidade_restante INTEGER,
        porcentagem INTEGER DEFAULT 0,
        urgencia TEXT DEFAULT 'alta' CHECK(urgencia IN ('alta', 'media', 'baixa', 'ok')),
        status TEXT DEFAULT 'precisando' CHECK(status IN ('precisando', 'ok')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- 🤝 DOAÇÕES
      CREATE TABLE IF NOT EXISTS doacoes (
        id SERIAL PRIMARY KEY,
        ponto_id INTEGER REFERENCES pontos(id) ON DELETE CASCADE,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        tipo TEXT NOT NULL,
        quantidade INTEGER NOT NULL,
        observacao TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- 🚫 IPS BLOQUEADOS
      CREATE TABLE IF NOT EXISTS ips_bloqueados (
        id SERIAL PRIMARY KEY,
        ip TEXT NOT NULL UNIQUE,
        motivo TEXT,
        bloqueios INTEGER DEFAULT 1,
        blocked_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );

      -- 📋 LOG DE AUDITORIA
      CREATE TABLE IF NOT EXISTS auditoria (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        acao TEXT NOT NULL,
        entidade TEXT,
        entidade_id INTEGER,
        detalhes JSONB,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- 📊 ÍNDICES - USUÁRIOS
      CREATE INDEX IF NOT EXISTS idx_usuario_email ON usuarios(email);
      CREATE INDEX IF NOT EXISTS idx_usuario_status ON usuarios(status);
      CREATE INDEX IF NOT EXISTS idx_usuario_role ON usuarios(role);
      CREATE INDEX IF NOT EXISTS idx_usuario_totp_enabled ON usuarios(totp_enabled);
      CREATE INDEX IF NOT EXISTS idx_usuario_created_by ON usuarios(created_by);
      
      -- 📊 ÍNDICES - EMAIL CONFIG
      CREATE INDEX IF NOT EXISTS idx_email_config_active ON email_config(is_active) WHERE is_active = TRUE;
      CREATE INDEX IF NOT EXISTS idx_email_config_provider ON email_config(provider);
      
      -- 📊 ÍNDICES - PASSWORD RESET TOKENS
      CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON password_reset_tokens(expires_at);
      
      -- 📊 ÍNDICES - PONTOS
      CREATE INDEX IF NOT EXISTS idx_pontos_user ON pontos(user_id);
      CREATE INDEX IF NOT EXISTS idx_pontos_cidade ON pontos(cidade);
      CREATE INDEX IF NOT EXISTS idx_pontos_ativo ON pontos(ativo);
      
      -- 📊 ÍNDICES - NECESSIDADES
      CREATE INDEX IF NOT EXISTS idx_necessidades_ponto ON necessidades(ponto_id);
      CREATE INDEX IF NOT EXISTS idx_necessidades_urgencia ON necessidades(urgencia);
      CREATE INDEX IF NOT EXISTS idx_necessidades_status ON necessidades(status);
      
      -- 📊 ÍNDICES - DOAÇÕES
      CREATE INDEX IF NOT EXISTS idx_doacoes_ponto ON doacoes(ponto_id);
      CREATE INDEX IF NOT EXISTS idx_doacoes_usuario ON doacoes(usuario_id);
      CREATE INDEX IF NOT EXISTS idx_doacoes_created ON doacoes(created_at);
      
      -- 📊 ÍNDICES - IPS BLOQUEADOS
      CREATE INDEX IF NOT EXISTS idx_ips ON ips_bloqueados(ip);
      CREATE INDEX IF NOT EXISTS idx_ips_expira ON ips_bloqueados(expires_at);
      
      -- 📊 ÍNDICES - AUDITORIA
      CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
      CREATE INDEX IF NOT EXISTS idx_auditoria_acao ON auditoria(acao);
      CREATE INDEX IF NOT EXISTS idx_auditoria_created ON auditoria(created_at);
    `);

    await client.query('COMMIT');
    logger.info('🌐 Banco de dados PostgreSQL inicializado/atualizado com sucesso');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('❌ Erro ao inicializar banco:', err);
    throw err; // Propaga o erro para o servidor saber que falhou
  } finally {
    client.release();
  }
}