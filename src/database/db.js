import pkg from 'pg';
const  { Pool } = pkg;
import { logger } from '../config/logger.js'; // Ajuste o caminho se necessário
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

// Função para inicializar as tabelas
export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      -- 👤 USUÁRIOS
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        telefone TEXT,
        endereco TEXT,
        role TEXT DEFAULT 'user' CHECK(role IN ('user', 'ponto', 'admin')),
        status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'pendente', 'rejeitado', 'inativo')),
        ultimo_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
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
        detalhes TEXT,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- 📊 ÍNDICES
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

    await client.query('COMMIT');
    logger.info('✅ Banco de dados PostgreSQL inicializado com sucesso');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('❌ Erro ao inicializar banco:', err);
  } finally {
    client.release();
  }
}