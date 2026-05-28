import bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/middlewares/error.middleware';

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) {
  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) throw new AppError('E-mail já cadastrado.', 409);

  const passwordHash = await bcrypt.hash(data.password, 12);
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
    },
    select: { id: true, name: true, email: true, role: true },
  });
}

export async function updateUser(
  id: string,
  data: { name?: string; email?: string; role?: UserRole; active?: boolean },
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('Usuário não encontrado.', 404);

  if (data.email) {
    const conflict = await prisma.user.findFirst({
      where: { email: data.email.toLowerCase(), id: { not: id } },
    });
    if (conflict) throw new AppError('E-mail já em uso.', 409);
  }

  return prisma.user.update({
    where: { id },
    data: { ...data, email: data.email?.toLowerCase() },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
}

export async function changePassword(id: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('Usuário não encontrado.', 404);

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new AppError('Senha atual incorreta.', 400);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}

export async function resetPassword(id: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('Usuário não encontrado.', 404);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}
