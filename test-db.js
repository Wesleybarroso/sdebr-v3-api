// test-db.js
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

console.log('🔍 URL:', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  connectionTimeoutMillis: 3000
});

try {
  const res = await pool.query('SELECT version() as pg_version');
  console.log('✅ SUCESSO! PostgreSQL:', res.rows[0].pg_version);
} catch (err) {
  console.error('❌ ERRO:', err.code, err.message);
} finally {
  await pool.end();
  process.exit();
}