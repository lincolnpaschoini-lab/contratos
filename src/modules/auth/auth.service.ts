import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { signToken } from '../../shared/middlewares/auth.middleware';
import { AppError } from '../../shared/middlewares/error.middleware';
import { logger } from '../../config/logger';

const REMEMBER_ME_EXPIRY = '30d';
const REMEMBER_ME_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dias em ms
const DEFAULT_MAX_AGE     =  8 * 60 * 60 * 1000;       // 8h em ms

export async function loginUser(email: string, password: string, rememberMe = false) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (!user || !user.active) {
    throw new AppError('Credenciais inválidas.', 401);
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    logger.warn(`Tentativa de login inválida para ${email}`);
    throw new AppError('Credenciais inválidas.', 401);
  }

  const token = signToken(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    rememberMe ? REMEMBER_ME_EXPIRY : undefined,
  );

  logger.info(`Login realizado: ${user.email} (${user.role})${rememberMe ? ' — lembrar usuário' : ''}`);

  return {
    token,
    cookieMaxAge: rememberMe ? REMEMBER_ME_MAX_AGE : DEFAULT_MAX_AGE,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}
