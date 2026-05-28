import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';

export const defaultRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas requisições. Tente novamente em instantes.' },
});

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

export const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: env.WEBHOOK_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Rate limit de webhook atingido.' },
});
