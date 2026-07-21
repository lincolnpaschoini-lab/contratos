import { StepName } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/middlewares/error.middleware';

export async function getAllSlaRules() {
  return prisma.slaRule.findMany({ orderBy: [{ stepName: 'asc' }, { companyId: 'asc' }] });
}

export async function deleteCompanySlaRule(stepName: StepName, companyId: string) {
  const rule = await prisma.slaRule.findFirst({ where: { stepName, companyId } });
  if (!rule) return;
  await prisma.slaRule.delete({ where: { id: rule.id } });
}

export async function upsertCompanySlaRule(
  stepName: StepName,
  companyId: string,
  data: { businessDays: number; active: boolean; notifyEmails: string | null; notifyOnNewLead: boolean },
) {
  if (data.businessDays < 0) throw new AppError('Dias úteis deve ser maior ou igual a zero.', 400);
  const existing = await prisma.slaRule.findFirst({ where: { stepName, companyId } });
  if (existing) {
    return prisma.slaRule.update({ where: { id: existing.id }, data });
  }
  return prisma.slaRule.create({ data: { stepName, companyId, ...data } });
}

export async function setSlaStepMode(stepName: StepName, mode: 'GLOBAL' | 'INDIVIDUAL') {
  const existing = await prisma.slaRule.findFirst({ where: { stepName, companyId: null } });
  if (existing) {
    return prisma.slaRule.update({ where: { id: existing.id }, data: { mode } });
  }
  return prisma.slaRule.create({ data: { stepName, companyId: null, mode, businessDays: 1, active: true } });
}

export async function updateSlaRule(
  id: string,
  businessDays: number,
  active: boolean,
  notifyEmails?: string | null,
  notifyOnNewLead?: boolean,
) {
  const rule = await prisma.slaRule.findUnique({ where: { id } });
  if (!rule) throw new AppError('Regra de SLA não encontrada.', 404);
  if (businessDays < 0) throw new AppError('Dias úteis deve ser maior ou igual a zero.', 400);

  return prisma.slaRule.update({
    where: { id },
    data: {
      businessDays,
      active,
      notifyEmails: notifyEmails ?? null,
      notifyOnNewLead: notifyOnNewLead ?? false,
    },
  });
}

// ─── Notificação de definição de beneficiários ───────────────────────────────

export async function getBeneficiaryNotifyRules() {
  return prisma.beneficiaryNotifyRule.findMany({ orderBy: [{ companyId: 'asc' }] });
}

export async function upsertGlobalBeneficiaryNotify(notifyEmails: string | null, active: boolean) {
  const existing = await prisma.beneficiaryNotifyRule.findFirst({ where: { companyId: null } });
  if (existing) {
    return prisma.beneficiaryNotifyRule.update({ where: { id: existing.id }, data: { notifyEmails, active } });
  }
  return prisma.beneficiaryNotifyRule.create({ data: { companyId: null, notifyEmails, active } });
}

export async function upsertCompanyBeneficiaryNotify(companyId: string, notifyEmails: string | null, active: boolean) {
  const existing = await prisma.beneficiaryNotifyRule.findFirst({ where: { companyId } });
  if (existing) {
    return prisma.beneficiaryNotifyRule.update({ where: { id: existing.id }, data: { notifyEmails, active } });
  }
  return prisma.beneficiaryNotifyRule.create({ data: { companyId, notifyEmails, active } });
}

export async function deleteCompanyBeneficiaryNotify(companyId: string) {
  const existing = await prisma.beneficiaryNotifyRule.findFirst({ where: { companyId } });
  if (!existing) return;
  await prisma.beneficiaryNotifyRule.delete({ where: { id: existing.id } });
}

export async function setBeneficiaryMode(mode: 'GLOBAL' | 'INDIVIDUAL') {
  const existing = await prisma.beneficiaryNotifyRule.findFirst({ where: { companyId: null } });
  if (existing) {
    return prisma.beneficiaryNotifyRule.update({ where: { id: existing.id }, data: { mode } });
  }
  return prisma.beneficiaryNotifyRule.create({ data: { companyId: null, mode, active: true } });
}
