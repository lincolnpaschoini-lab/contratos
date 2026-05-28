import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { signToken } from '../../shared/middlewares/auth.middleware';
import { AppError } from '../../shared/middlewares/error.middleware';
import { logger } from '../../config/logger';

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (!user || !user.active) {
    throw new AppError('Credenciais inválidas.', 401);
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    logger.warn(`Tentativa de login inválida para ${email}`);
    throw new AppError('Credenciais inválidas.', 401);
  }

  const token = signToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  logger.info(`Login realizado: ${user.email} (${user.role})`);

  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}
