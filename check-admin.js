// check-admin.js
import pool from './src/database/db.js';
import bcrypt from 'bcrypt';

console.log('🔍 Verificando admin@sdebr.com...\n');

try {
  // 1. Busca o usuário
  const result = await pool.query(
    "SELECT id, nome, email, status, role, senha FROM usuarios WHERE email = $1",
    ['admin@sdebr.com']
  );
  
  if (result.rows.length === 0) {
    console.log('❌ Admin NÃO encontrado no banco!');
    console.log('\n🔧 Criando admin agora...');
    
    const senhaHash = await bcrypt.hash('admin123', 10);
    const insert = await pool.query(
      `INSERT INTO usuarios (nome, email, senha, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      ['Administrador', 'admin@sdebr.com', senhaHash, 'admin', 'ativo']
    );
    
    console.log(`✅ Admin criado com ID: ${insert.rows[0].id}`);
    console.log('🔑 Senha definida: admin123');
  } else {
    const user = result.rows[0];
    console.log('✅ Admin encontrado:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Nome: ${user.nome}`);
    console.log(`   Status: ${user.status} ${user.status !== 'ativo' ? '⚠️ PRECISA SER "ativo"' : '✅'}`);
    console.log(`   Role: ${user.role} ${user.role !== 'admin' ? '⚠️ PRECISA SER "admin"' : '✅'}`);
    
    // 2. Se status ou role estiverem errados, corrige
    if (user.status !== 'ativo' || user.role !== 'admin') {
      console.log('\n🔧 Corrigindo status e role...');
      await pool.query(
        "UPDATE usuarios SET status = 'ativo', role = 'admin', updated_at = NOW() WHERE id = $1",
        [user.id]
      );
      console.log('✅ Correção aplicada!');
    }
    
    // 3. Testa se a senha 'admin123' funciona
    const senhaOk = await bcrypt.compare('admin123', user.senha);
    console.log(`\n🔐 Senha 'admin123' válida: ${senhaOk ? '✅ SIM' : '❌ NÃO'}`);
    
    if (!senhaOk) {
      console.log('\n🔧 Resetando senha para "admin123"...');
      const novaHash = await bcrypt.hash('admin123', 10);
      await pool.query(
        "UPDATE usuarios SET senha = $1, updated_at = NOW() WHERE id = $2",
        [novaHash, user.id]
      );
      console.log('✅ Senha resetada!');
    }
  }
  
  console.log('\n🎉 Verificação concluída! Tente login agora:');
  console.log('   curl http://localhost:3000/api/v1/login -X POST -H "Content-Type: application/json" -d \'{"email":"admin@sdebr.com","senha":"admin123"}\'');
  
} catch (err) {
  console.error('❌ Erro:', err.message);
} finally {
  await pool.end();
  process.exit(0);
}