🐘 SDEBR API v3.0 — Sistema de Doações e Benefícios Recíprocos
API RESTful completa para gestão de pontos de coleta, necessidades e doações, com autenticação JWT, validação Zod, rate limiting e auditoria.

✅ 100% compatível com PostgreSQL
✅ Migração concluída de MySQL/SQLite
✅ 18/18 testes automatizados passando
✅ Pronto para produção

📋 Índice
✨ Funcionalidades
🛠️ Tecnologias
📦 Requisitos
🚀 Instalação
⚙️ Variáveis de Ambiente
🗄️ Banco de Dados
🔐 Autenticação
🗺️ Rotas da API
🧪 Testes
🌐 Deploy
🤝 Contribuindo
📄 Licença

✨ Funcionalidades
👤 Usuários e Autenticação
✅ Cadastro com validação Zod (email, senha forte, telefone)
✅ Login com JWT (access token + refresh token)
✅ Alteração de senha com validação cruzada
✅ Perfil do usuário logado (/me)
✅ Roles: user, ponto, admin
📍 Pontos de Coleta
✅ CRUD completo de pontos (admin apenas para criar/editar)
✅ Listagem pública com filtros (cidade, estado, busca)
✅ Validação: usuário só pode ter pontos na mesma cidade
✅ Limitação de pontos por usuário (configurável)
📦 Necessidades
✅ Cadastro de necessidades por ponto (dono do ponto ou admin)
✅ Cálculo automático de porcentagem e urgência
✅ Status dinâmico: precisando → ok quando atendida
✅ Listagem pública ordenada por urgência
🤝 Doações
✅ Registro de doações vinculadas a necessidades
✅ Atualização automática de quantidade restante
✅ Rate limiting para prevenir spam (5/min por usuário)
✅ Histórico com paginação e filtros
👑 Painel Administrativo
✅ Dashboard com métricas em tempo real
✅ Aprovação/rejeição de pontos pendentes
✅ Gestão de usuários (listar, deletar)
✅ Logs de auditoria com filtro e paginação
✅ Gerenciamento de IPs bloqueados
🔐 Segurança
✅ JWT com algoritmo configurável (HS256/RS256)
✅ Bcrypt com salt rounds dinâmico (.env)
✅ Rate limiting por IP e por usuário
✅ IP blocker automático em caso de abuso
✅ Helmet + CORS configurados
✅ Validação Zod em todas as entradas
🧹 Manutenção
✅ Cleanup agendado: IPs expirados + auditoria antiga (>90 dias)
✅ Seed automático do admin no startup
✅ Logs estruturados com pino/winston
✅ Graceful shutdown com SIGTERM/SIGINT

🛠️ Tecnologias

Categoria            Tecnológia
ROUNTIME             Node.js 24+ ES Modules
FRAMEKORK            EXPRESS 4.X
BANCO DE DADOS       POSTGRESQL 14+ com pg
AUTENTICAÇÃO         JWT (jsonwebtoken), Bcrypt
VALIDAÇÃO            ZOD (schema validation + sanition)
SEGURANÇA            HELMET, CORS, EXPRESS-RATE-LIMIT
LOGS                 PINO/WINSTON COM FORMATAÇAO ESTRTUTURADA
TESTES               PowerShell scripts + Invoke-RestMethod
DEPLOY               Render, Railway, VPS, (Docker opcional)


📦 Requisitos
Node.js >= 20.x (recomendado 24.x)
PostgreSQL >= 14.x
npm >= 9.x ou yarn >= 1.22.x
PowerShell 7+ (para testes) ou qualquer cliente HTTP


🚀 Instalação
1. Clone o repositório
git clone https://github.com/seu-usuario/sdebr-v3-api.git
cd sdebr-v3-api

2. Instale as dependências
npm install
# ou
yarn install

3. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas configurações (veja seção abaixo)

4. Inicie o banco de dados
# Certifique-se que o PostgreSQL está rodando
# O script initDB cria as tabelas automaticamente no primeiro start

5. Inicie o servidor
# Desenvolvimento (com nodemon + hot reload)
npm run dev

# Produção
npm start

6. Verifique o health check
curl http://localhost:3000/
# Resposta esperada:
# {"status":"online","app":"SDEBR API","version":"1.0.0",...}

⚙️ Variáveis de Ambiente
Copie .env.example para .env e ajuste:
# 🌐 Servidor
PORT=3000
NODE_ENV=development

# 🗄️ PostgreSQL
DATABASE_URL=postgres://usuario:senha@localhost:5432/sdebr-db

# 🔐 JWT
JWT_SECRET=sua-chave-secreta-muito-longa-e-segura-aqui
JWT_REFRESH_SECRET=outra-chave-diferente-para-refresh-token
JWT_ALGORITHM=HS256
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# 🔒 Bcrypt
BCRYPT_SALT_ROUNDS=12

# 🚫 Rate Limiting
RATE_LIMIT_GLOBAL=100
RATE_LIMIT_LOGIN=10
RATE_LIMIT_REGISTER=5
RATE_LIMIT_DOACAO=5

# 📍 Regras de Negócio
MAX_PONTOS_POR_USUARIO=2

# 🌍 CORS (opcional)
CORS_ORIGIN=http://localhost:3000,https://seu-frontend.com


🗄️ Banco de Dados
Tabelas Principais
👤 usuarios
   ├─ id (SERIAL PK)
   ├─ nome, email (UNIQUE), senha (bcrypt)
   ├─ telefone, endereco
   ├─ role: 'user' | 'ponto' | 'admin'
   ├─ status: 'ativo' | 'pendente' | 'rejeitado' | 'inativo'
   ├─ ultimo_login, created_at, updated_at

📍 pontos
   ├─ id (SERIAL PK)
   ├─ nome, rua, numero, bairro, cidade, estado, cep
   ├─ complemento, descricao, ativo (BOOLEAN)
   ├─ user_id → usuarios(id) [ON DELETE CASCADE]
   ├─ created_at, updated_at

📦 necessidades
   ├─ id (SERIAL PK)
   ├─ ponto_id → pontos(id) [ON DELETE CASCADE]
   ├─ tipo, quantidade, quantidade_restante
   ├─ porcentagem (0-100), urgencia: 'alta'|'media'|'baixa'|'ok'
   ├─ status: 'precisando' | 'ok'
   ├─ created_at, updated_at

🤝 doacoes
   ├─ id (SERIAL PK)
   ├─ ponto_id → pontos(id) [ON DELETE CASCADE]
   ├─ usuario_id → usuarios(id) [ON DELETE SET NULL]
   ├─ tipo, quantidade, observacao
   ├─ created_at

🚫 ips_bloqueados
   ├─ id, ip (UNIQUE), motivo, bloqueios
   ├─ blocked_at, expires_at

📋 auditoria
   ├─ id, usuario_id → usuarios(id) [ON DELETE SET NULL]
   ├─ acao, entidade, entidade_id, detalhes (JSON)
   ├─ ip, created_at

   Índices Criados Automaticamente
   -- Performance em buscas frequentes
CREATE INDEX idx_usuario_email ON usuarios(email);
CREATE INDEX idx_usuario_status ON usuarios(status);
CREATE INDEX idx_pontos_user ON pontos(user_id);
CREATE INDEX idx_pontos_cidade ON pontos(cidade);
CREATE INDEX idx_necessidades_ponto ON necessidades(ponto_id);
CREATE INDEX idx_necessidades_urgencia ON necessidades(urgencia);
CREATE INDEX idx_doacoes_ponto ON doacoes(ponto_id);
CREATE INDEX idx_doacoes_usuario ON doacoes(usuario_id);
CREATE INDEX idx_ips ON ips_bloqueados(ip);
CREATE INDEX idx_ips_expira ON ips_bloqueados(expires_at);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);

Migração PostgreSQL
✅ Esta versão foi migrada de MySQL/SQLite para PostgreSQL. Todas as queries usam:
Placeholders: $1, $2, $3 (não ?)
Booleanos: true/false (não 1/0)
Funções de data: NOW(), CURRENT_DATE (não datetime('now'))
Acesso a resultados: result.rows (não result direto)
IDs inseridos: RETURNING id (não lastInsertId)

🔐 Autenticação
Fluxo JWT
1. POST /api/v1/login
   → { email, senha }
   ← { token, user }

2. Use o token em rotas protegidas:
   Authorization: Bearer <token>

3. Token expira em 1h (configurável)
4. Refresh token disponível (opcional)

Credenciais de Teste (Seed Automático)
{
  "email": "admin@sdebr.com",
  "senha": "admin123"
}

⚠️ A senha é resetada automaticamente se o hash estiver inválido. Use node check-admin.js para verificar/corrigir.


## Senha Forte (Validação Zod)
// Requisitos mínimos:
- 8+ caracteres
- 1 letra maiúscula
- 1 número
// Recomendado para produção:
- 1 letra minúscula
- 1 caractere especial

🗺️ Rotas da API
Todas as rotas estão versionadas em /api/v1

Base URL
text
http://localhost:3000/api/v1
🏠 Health Check
Método	Endpoint	Descrição
GET	/	Status da API (público)

👤 Autenticação
Método	Endpoint	Descrição	Rate Limit
POST	/register	Registrar doador/ponto	5/hora
POST	/login	Login	10/15min
GET	/me	Meu perfil (auth)	-
PUT	/alterar-senha	Alterar senha (auth)	-

📍 Pontos de Coleta
Método	Endpoint	Descrição	Permissão
GET	/pontos	Listar pontos (público)	-
GET	/pontos/:id	Buscar ponto + necessidades	-
GET	/pontos/meus	Meus pontos	auth
POST	/pontos	Criar ponto	admin
PUT	/pontos/:id	Atualizar ponto	admin
DELETE	/pontos/:id	Deletar ponto	admin
Filtros para listagem:

Parâmetro	Exemplo	Descrição
cidade	?cidade=São Paulo	Filtro por cidade
estado	?estado=SP	Filtro por UF
busca	?busca=centro	Busca em nome/bairro
page	?page=2	Página (padrão: 1)
limit	?limit=20	Itens por página (max: 100)

📦 Necessidades
Método	Endpoint	Descrição	Permissão
GET	/necessidades	Listar necessidades (público)	-
GET	/necessidades/:id	Buscar necessidade	-
POST	/necessidades	Criar necessidade	ponto/admin
PATCH	/necessidades/:id	Atualizar necessidade	ponto/admin
DELETE	/necessidades/:id	Deletar necessidade	ponto/admin

🤝 Doações
Método	Endpoint	Descrição	Permissão	Rate Limit
GET	/doacoes	Listar doações (público)	-	-
POST	/doacoes	Registrar doação	user/admin	5/minuto
DELETE	/doacoes/:id	Deletar doação	admin	-


👑 Administração (Painel Brasileiro)

| Método     | Endpoint              | Descrição                                                  |Permissão|
| :---       | :---                  | :---                                                       | :---    |
| **GET**    | `/admin/dashboard`    | Retorna métricas táticas e estatísticas do sistema         | `admin` |
| **GET**    | `/admin/ips`          | Lista todos os endereços de IP bloqueados pelo firewall    | `admin` |
| **DELETE** | `/admin/ip/:ip`       | Remove o bloqueio de um IP específico (Whitelist manual)   | `admin` |
| **GET**    | `/admin/solicitacoes` | Lista solicitações de novos pontos aguardando aprovação    | `admin` |
| **PATCH**  | `/admin/aprovar/:id`  | Altera status do usuário para 'ativo' e role para 'ponto'  | `admin` |
| **PATCH**  | `/admin/rejeitar/:id` | Rejeita a solicitação e marca usuário como 'rejeitado'     | `admin` |
| **GET**    | `/admin/auditoria`    | Histórico de ações críticas realizadas por administradores | `admin` |
| **GET**    | `/admin/logs`         | Logs brutos de eventos e erros do sistema (Console)        | `admin` |
| **GET**    | `/admin/usuarios`     | Lista todos os usuários registrados na base SDEBR          | `admin` |
| **DELETE** | `/admin/usuarios/:id` | Remove permanentemente um usuário do sistema               | `admin` |


🧪 Testes
Script de Teste Automatizado (PowerShell)
# Salve como test-api.ps1 na raiz do projeto
# Execute:
.\test-api.ps1

# Resultado esperado:
# ✅ Testes aprovados: 18/18
# 📈 Taxa de sucesso: 100.0%
# 🎉 API SDEBR 100% FUNCIONAL!

Testes Manuais Rápidos
# Health check
Invoke-RestMethod -Uri "http://localhost:3000/"

# Login
$login = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/login" `
  -Method Post -ContentType "application/json" `
  -Body '{"email":"admin@sdebr.com","senha":"admin123"}'

# Rota protegida
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/me" `
  -Headers @{ Authorization = "Bearer $($login.token)" }

🌐 Deploy
Opção 1: Render (Gratuito, Fácil)
1.Crie conta em render.com
2.Conecte seu repositório GitHub
3.Configure o Web Service:

Name: sdebr-api
Environment: Node
Build Command: npm install
Start Command: node server.js
Region: São Paulo (se disponível)

4. Adicione as Environment Variables (veja seção .env)
.env)

5.Deploy!🚀
Opção 2: Railway (PostgreSQL Incluso)
Acesse railway.app
Deploy from GitHub
Adicione o plugin PostgreSQL
Configure as variáveis de ambiente
Deploy automático a cada push

Opção 3: VPS Própria (DigitalOcean, Hetzner)

# Exemplo com Docker (opcional)
docker build -t sdebr-api .
docker run -d -p 3000:3000 --env-file .env sdebr-api

# Ou direto com PM2
npm install -g pm2
pm2 start server.js --name sdebr-api
pm2 save
pm2 startup


🔐 Checklist de Produção
NODE_ENV=production
DATABASE_URL apontando para banco em produção
JWT_SECRET e JWT_REFRESH_SECRET com valores seguros (gerar com openssl rand -hex 32)
BCRYPT_SALT_ROUNDS=12 ou maior
CORS configurado para domínio do front-end
Logs enviados para serviço externo (opcional: Logtail, Datadog)
Monitoramento de uptime (opcional: UptimeRobot, Healthchecks.io)

🤝 Contribuindo
Fork o projeto
Crie uma branch para sua feature (git checkout -b feature/minha-feature)
Commit suas mudanças (git commit -m 'feat: adiciona minha feature')
Push para a branch (git push origin feature/minha-feature)
Abra um Pull Request

Padrões do Projeto
✅ ES Modules (import/export)
✅ Async/await para operações assíncronas
✅ Validação Zod em todas as entradas de usuário
✅ Logs estruturados com logger.info/error
✅ Tratamento de erro com try/catch + resposta JSON
✅ PostgreSQL: usar pool.query() com $1, $2 placeholders

📄 Licença
Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.

🆘 Suporte e Dúvidas
🐛 Bugs: Abra uma issue no GitHub com steps para reproduzir
💡 Features: Discuta em uma issue antes de implementar
❓ Dúvidas: Use as discussões do GitHub ou entre em contato

🙏 Agradecimentos
Node.js — Runtime JavaScript
Express — Framework web minimalista
PostgreSQL — Banco de dados robusto e open-source
Zod — Validação de schema com TypeScript-first
bcrypt — Hash de senhas seguro

🐘 Feito com ❤️ para facilitar doações e impacto social.
SDEBR API v3.0 — 100% PostgreSQL, 100% Funcional, 100% Pronta para Produção. 🚀🇧🇷

versão V3.0 Data 2026-04 
mudanças principais:
✅ Migração completa para PostgreSQL
✅ Validação Zod em todas as entradas
✅ Rate limiting + IP blocker
✅ Auditoria automática
✅ 18/18 testes passando

