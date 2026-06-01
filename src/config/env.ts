import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  COOKIE_SECRET: z.string().min(16),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // ─── Pipedrive — Paschoini (legado, mantém retrocompatibilidade) ─────────────
  PIPEDRIVE_API_TOKEN: z.string().optional(),
  PIPEDRIVE_DOMAIN: z.string().optional(),
  PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID: z.string().default(''),
  PIPEDRIVE_CONTRACT_PREPARATION_STAGE_ID: z.string().default(''),
  PIPEDRIVE_CONTRACT_SIGNING_STAGE_ID: z.string().default(''),
  PIPEDRIVE_WEBHOOK_SECRET: z.string().optional(),

  // ─── Pipedrive — Paschoini (company_id para identificação multi-tenant) ──────
  PIPEDRIVE_PASCHOINI_COMPANY_ID: z.string().optional(),

  // ─── Pipedrive — Attivos ──────────────────────────────────────────────────────
  PIPEDRIVE_ATTIVOS_COMPANY_ID: z.string().optional(),
  PIPEDRIVE_ATTIVOS_API_TOKEN: z.string().optional(),
  PIPEDRIVE_ATTIVOS_DOMAIN: z.string().optional(),
  PIPEDRIVE_ATTIVOS_PROPOSAL_STAGE_ID: z.string().default(''),
  PIPEDRIVE_ATTIVOS_PREPARATION_STAGE_ID: z.string().default(''),
  PIPEDRIVE_ATTIVOS_SIGNING_STAGE_ID: z.string().default(''),

  // ─── Pipedrive — Focus ────────────────────────────────────────────────────────
  PIPEDRIVE_FOCUS_COMPANY_ID: z.string().optional(),
  PIPEDRIVE_FOCUS_API_TOKEN: z.string().optional(),
  PIPEDRIVE_FOCUS_DOMAIN: z.string().optional(),
  PIPEDRIVE_FOCUS_PROPOSAL_STAGE_ID: z.string().default(''),
  PIPEDRIVE_FOCUS_PREPARATION_STAGE_ID: z.string().default(''),
  PIPEDRIVE_FOCUS_SIGNING_STAGE_ID: z.string().default(''),

  CLICKSIGN_API_KEY: z.string().optional(),
  CLICKSIGN_API_URL: z.string().url().default('https://sandbox.clicksign.com'),
  CLICKSIGN_WEBHOOK_TOKEN: z.string().optional(),
  CLICKSIGN_INTERNAL_SIGNER_EMAILS: z.string().default(''),
  CLICKSIGN_INTERNAL_SIGNER_NAMES: z.string().default(''),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE_PATH: z.string().default('./logs'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(1000),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().default(500),

  // Microsoft Graph API (envio de e-mail)
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  GRAPH_SENDER_EMAIL: z.string().default('noreply@paschoini.adv.br'),
  REGISTRATION_NOTIFY_EMAIL: z.string().optional(),
  // E-mails separados por vírgula que recebem alerta de atraso de etapa
  DELAY_NOTIFY_EMAILS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
