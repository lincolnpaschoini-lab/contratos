import { StepName } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/middlewares/error.middleware';

export async function getAllSlaRules() {
  return prisma.slaRule.findMany({ orderBy: { stepName: 'asc' } });
}

export async function updateSlaRule(id: string, businessDays: number, active: boolean) {
  const rule = await prisma.slaRule.findUnique({ where: { id } });
  if (!rule) throw new AppError('Regra de SLA não encontrada.', 404);
  if (businessDays < 0) throw new AppError('Dias úteis deve ser maior ou igual a zero.', 400);

  return prisma.slaRule.update({ where: { id }, data: { businessDays, active } });
}
