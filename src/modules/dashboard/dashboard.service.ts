import { ContractStatus, StepName, StepStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { differenceInDays } from 'date-fns';

const STEP_ORDER: StepName[] = [
  StepName.PROPOSAL_ACCEPTED,
  StepName.CONTRACT_PREPARATION,
  StepName.CONTRACT_SIGNING,
  StepName.CONTRACT_REGISTRATION,
  StepName.CONTRACT_BILLING,
];

export async function getDashboardSummary() {
  const [
    totalInProgress,
    totalDelayed,
    totalCompleted,
    totalCancelled,
    pendingBillingAgg,
    completedWithDates,
    delayedByStep,
    contractsByStep,
  ] = await Promise.all([
    prisma.contractTracking.count({ where: { overallStatus: ContractStatus.IN_PROGRESS } }),
    prisma.contractTracking.count({ where: { overallStatus: ContractStatus.DELAYED } }),
    prisma.contractTracking.count({ where: { overallStatus: ContractStatus.COMPLETED } }),
    prisma.contractTracking.count({ where: { overallStatus: ContractStatus.CANCELLED } }),

    // Valor total pendente de faturamento
    prisma.pipedriveDeal.aggregate({
      _sum: { value: true },
      where: {
        contractTracking: {
          overallStatus: { in: [ContractStatus.IN_PROGRESS, ContractStatus.DELAYED] },
        },
      },
    }),

    // Para cálculo de tempo médio
    prisma.contractTracking.findMany({
      where: { overallStatus: ContractStatus.COMPLETED, completedAt: { not: null } },
      select: { proposalAcceptedAt: true, completedAt: true },
      take: 100,
      orderBy: { completedAt: 'desc' },
    }),

    // Atrasados por etapa
    prisma.contractStep.groupBy({
      by: ['stepName'],
      _count: { _all: true },
      where: { status: StepStatus.DELAYED },
    }),

    // Contratos agrupados por etapa atual (apenas ativos)
    prisma.contractTracking.findMany({
      where: {
        overallStatus: { in: [ContractStatus.IN_PROGRESS, ContractStatus.DELAYED] },
      },
      orderBy: [{ overallStatus: 'asc' }, { proposalAcceptedAt: 'asc' }],
      include: {
        customer: { select: { id: true, name: true } },
        pipedriveDeal: { select: { title: true, value: true } },
        assignedUser: { select: { id: true, name: true } },
        steps: {
          orderBy: { stepOrder: 'asc' },
          select: { stepName: true, status: true, dueAt: true, stepOrder: true },
        },
      },
    }),
  ]);

  // Tempo médio proposta → faturamento
  let avgDays = 0;
  if (completedWithDates.length > 0) {
    const total = completedWithDates.reduce((sum, c) => {
      return c.completedAt ? sum + differenceInDays(c.completedAt, c.proposalAcceptedAt) : sum;
    }, 0);
    avgDays = Math.round(total / completedWithDates.length);
  }

  const delayedStepMap: Record<string, number> = {};
  delayedByStep.forEach((s) => { delayedStepMap[s.stepName] = s._count._all; });

  // Agrupa contratos por etapa atual
  const pipelineByStep: Record<string, { count: number; contracts: typeof contractsByStep }> = {};
  for (const step of STEP_ORDER) {
    const inStep = contractsByStep.filter((c) => c.currentStep === step);
    pipelineByStep[step] = { count: inStep.length, contracts: inStep };
  }

  const stepCountMap: Record<string, number> = {};
  for (const step of STEP_ORDER) {
    stepCountMap[step] = pipelineByStep[step].count;
  }

  return {
    totals: {
      inProgress: totalInProgress,
      delayed: totalDelayed,
      completed: totalCompleted,
      cancelled: totalCancelled,
      total: totalInProgress + totalDelayed + totalCompleted + totalCancelled,
    },
    pendingBillingValue: Number(pendingBillingAgg._sum.value ?? 0),
    avgDaysToComplete: avgDays,
    stepCounts: stepCountMap,
    delayedByStep: delayedStepMap,
    pipelineByStep,
  };
}
