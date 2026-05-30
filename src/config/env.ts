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

  PIPEDRIVE_API_TOKEN: z.string().optional(),
  PIPEDRIVE_DOMAIN: z.string().optional(),
  PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID: z.string().default(''),
  PIPEDRIVE_CONTRACT_PREPARATION_STAGE_ID: z.string().default(''),
  PIPEDRIVE_CONTRACT_SIGNING_STAGE_ID: z.string().default(''),
  PIPEDRIVE_WEBHOOK_SECRET: z.string().optional(),

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
