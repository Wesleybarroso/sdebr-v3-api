import { z } from 'zod';

export const registerSchema = z.object({
  nome: z.string()
    .min(2, 'Nome deve ter no mínimo 2 caracteres')
    .max(100, 'Nome muito longo')
    .trim(),

  email: z.string()
    .email('Email inválido')
    .toLowerCase()
    .trim(),

  telefone: z.string()
    .min(8, 'Telefone inválido')
    .max(20, 'Telefone muito longo')
    .trim(),

  endereco: z.string()
    .min(5, 'Endereço muito curto')
    .max(255, 'Endereço muito longo')
    .trim(),

  senha: z.string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(128, 'Senha muito longa')
    .regex(/[A-Z]/, 'Senha deve conter ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Senha deve conter ao menos um número'),

  quer_ser_ponto: z.boolean().optional().default(false)
});

export const loginSchema = z.object({
  email: z.string()
    .email('Email inválido')
    .toLowerCase()
    .trim(),

  senha: z.string()
    .min(1, 'Informe a senha')
    .max(128)
});

export const alterarSenhaSchema = z.object({
  senha_atual: z.string().min(1, 'Informe a senha atual'),
  nova_senha: z.string()
    .min(8, 'Nova senha deve ter no mínimo 8 caracteres')
    .max(128)
    .regex(/[A-Z]/, 'Deve conter ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Deve conter ao menos um número')
}).refine(
  (data) => data.senha_atual !== data.nova_senha,
  { message: 'Nova senha deve ser diferente da senha atual', path: ['nova_senha'] }
);