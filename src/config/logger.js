import winston from 'winston';
import fs from 'fs';

// garante que a pasta de logs existe
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true });
}

// ✅ Função auxiliar para horário de Brasília
const brTimestamp = () => new Date().toLocaleString('pt-BR', { 
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const transports = [
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp({ format: brTimestamp }), // ✅ Horário local nos arquivos
      winston.format.errors({ stack: true }),
      winston.format.json()
    )
  }),
  new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10,
    format: winston.format.combine(
      winston.format.timestamp({ format: brTimestamp }), // ✅ Horário local nos arquivos
      winston.format.errors({ stack: true }),
      winston.format.json()
    )
  })
];

// console colorido apenas fora de produção
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: brTimestamp }), // ✅ Horário local no console também
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${extras}`;
        })
      )
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
  format: winston.format.combine(
    // ⚠️ Removido timestamp global aqui para não duplicar/conflitar com os transports
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  exitOnError: false
});