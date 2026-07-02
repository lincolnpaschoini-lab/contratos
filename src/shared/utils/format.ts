import { formatDistance, parseISO, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ContractStatus, StepName, StepStatus } from '@prisma/client';

const TIMEZONE = 'America/Sao_Paulo';

function toDate(date: Date | string): Date {
  return typeof date === 'string' ? parseISO(date) : date;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(toDate(date));
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(date));
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return '-';
  return formatDistance(toDate(date), new Date(), { addSuffix: true, locale: ptBR });
}

/** Dias corridos de atraso, contados por dia de calendário (não por blocos de 24h). */
export function daysLate(dueAt: Date | string | null | undefined): number {
  if (!dueAt) return 0;
  return Math.max(0, differenceInCalendarDays(new Date(), toDate(dueAt)));
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return 'R$ 0,00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

export const STEP_LABELS: Record<StepName, string> = {
  PROPOSAL_ACCEPTED: 'Proposta Aceita',
  CONTRACT_PREPARATION: 'Preparação do Contrato',
  CONTRACT_SIGNING: 'Assinatura do Contrato',
  CONTRACT_REGISTRATION: 'Cadastro do Contrato',
  CONTRACT_BILLING: 'Faturamento',
};

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em Andamento',
  COMPLETED: 'Concluído',
  DELAYED: 'Atrasado',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  IN_PROGRESS: 'Em Andamento',
  DELAYED: 'Atrasado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

export const STEP_STATUS_CSS: Record<StepStatus, string> = {
  PENDING: 'secondary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  DELAYED: 'danger',
};

export const CONTRACT_STATUS_CSS: Record<ContractStatus, string> = {
  IN_PROGRESS: 'warning',
  DELAYED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
};

export function stepOrder(stepName: StepName): number {
  const order: Record<StepName, number> = {
    PROPOSAL_ACCEPTED: 1,
    CONTRACT_PREPARATION: 2,
    CONTRACT_SIGNING: 3,
    CONTRACT_REGISTRATION: 4,
    CONTRACT_BILLING: 5,
  };
  return order[stepName];
}

export const STEP_NAMES_ORDERED: StepName[] = [
  'PROPOSAL_ACCEPTED',
  'CONTRACT_PREPARATION',
  'CONTRACT_SIGNING',
  'CONTRACT_REGISTRATION',
  'CONTRACT_BILLING',
];
