import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { logger } from '../config/logger.js';

// ======================
// 🔌 SINGLETON DE CONEXÃO
// ======================
let db = null;

export async function connectDB() {
  if (!db) {
    db = await open({
      filename: process.env.DB_PATH || './database.sqlite',
      driver: sqlite3.Database
    });

    // configurações de performance e integridade
    await db.run('PRAGMA foreign_keys = ON');
    await db.run('PRAGMA journal_mode = WAL');
    await db.run('PRAGMA synchronous = NORMAL');
    await db.run('PRAGMA cache_size = -20000'); // 20MB cache
    await db.run('PRAGMA temp_store = MEMORY');

    logger.info('Conexão com banco de dados estabelecida');
  }
  return db;
}

export async function closeDB() {
  if (db) {
    await db.close();
    db = null;
    logger.info('Conexão com banco encerrada');
  }
}

// ======================
// 🗄️ INICIALIZA SCHEMA
// ======================
export async function initDB() {
  const db = await connectDB();

  await db.exec(`
    -- ======================
    -- 👤 USUÁRIOS
    -- ======================
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('user', 'ponto', 'admin')),
      status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'pendente', 'rejeitado', 'inativo')),
      ultimo_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ======================
    -- 📍 PONTOS DE COLETA
    -- ======================
    CREATE TABLE IF NOT EXISTS pontos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      rua TEXT,
      numero TEXT,
      bairro TEXT,
      cidade TEXT,
      estado TEXT,
      cep TEXT,
      complemento TEXT,
      descricao TEXT,
      ativo INTEGER DEFAULT 1,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    -- ======================
    -- 📦 NECESSIDADES
    -- ======================
    CREATE TABLE IF NOT EXISTS necessidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ponto_id INTEGER,
      tipo TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      quantidade_restante INTEGER,
      porcentagem INTEGER DEFAULT 0,
      urgencia TEXT DEFAULT 'alta' CHECK(urgencia IN ('alta', 'media', 'baixa', 'ok')),
      status TEXT DEFAULT 'precisando' CHECK(status IN ('precisando', 'ok')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ponto_id) REFERENCES pontos(id) ON DELETE CASCADE
    );

    -- ======================
    -- 🤝 DOAÇÕES
    -- ======================
    CREATE TABLE IF NOT EXISTS doacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ponto_id INTEGER,
      usuario_id INTEGER,
      tipo TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      observacao TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ponto_id) REFERENCES pontos(id) ON DELETE CASCADE,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    -- ======================
    -- 🚫 IPS BLOQUEADOS
    -- ======================
    CREATE TABLE IF NOT EXISTS ips_bloqueados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      motivo TEXT,
      bloqueios INTEGER DEFAULT 1,
      blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    -- ======================
    -- 📋 LOG DE AUDITORIA
    -- ======================
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      acao TEXT NOT NULL,
      entidade TEXT,
      entidade_id INTEGER,
      detalhes TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    -- ======================
    -- ⚡ ÍNDICES
    -- ======================
    CREATE INDEX IF NOT EXISTS idx_usuario_email ON usuarios(email);
    CREATE INDEX IF NOT EXISTS idx_usuario_status ON usuarios(status);
    CREATE INDEX IF NOT EXISTS idx_pontos_user ON pontos(user_id);
    CREATE INDEX IF NOT EXISTS idx_pontos_cidade ON pontos(cidade);
    CREATE INDEX IF NOT EXISTS idx_necessidades_ponto ON necessidades(ponto_id);
    CREATE INDEX IF NOT EXISTS idx_necessidades_urgencia ON necessidades(urgencia);
    CREATE INDEX IF NOT EXISTS idx_doacoes_ponto ON doacoes(ponto_id);
    CREATE INDEX IF NOT EXISTS idx_doacoes_usuario ON doacoes(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_ips ON ips_bloqueados(ip);
    CREATE INDEX IF NOT EXISTS idx_ips_expira ON ips_bloqueados(expires_at);
    CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
  `);

  logger.info('Schema do banco inicializado com sucesso');
}