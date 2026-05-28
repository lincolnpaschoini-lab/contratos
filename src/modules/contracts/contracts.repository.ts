import { ContractStatus, Prisma, StepName, StepStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { PaginationParams, PaginatedResult } from '../../shared/types';

export interface ContractFilters {
  status?: ContractStatus;
  currentStep?: StepName;
  delayedStep?: StepName;  // filtra contratos com uma etapa específica em status DELAYED
  assignedUserId?: string;
  customerId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

const trackingInclude = {
  customer: true,
  pipedriveDeal: true,
  assignedUser: { select: { id: true, name: true, email: true } },
  steps: {
    orderBy: { stepOrder: 'asc' as const },
    include: {
      assignedUser: { select: { id: true, name: true } },
      histories: { orderBy: { createdAt: 'desc' as const }, take: 5 },
    },
  },
  clicksignDocs: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

export async function findAllTrackings(
  filters: ContractFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<any>> {
  const where: Prisma.ContractTrackingWhereInput = {};

  if (filters.status) where.overallStatus = filters.status;
  if (filters.currentStep) where.currentStep = filters.currentStep;
  if (filters.delayedStep) {
    where.steps = { some: { stepName: filters.delayedStep, status: StepStatus.DELAYED } };
  }
  if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
  if (filters.customerId) where.customerId = filters.customerId;

  if (filters.dateFrom || filters.dateTo) {
    where.proposalAcceptedAt = {};
    if (filters.dateFrom) (where.proposalAcceptedAt as any).gte = filters.dateFrom;
    if (filters.dateTo) (where.proposalAcceptedAt as any).lte = filters.dateTo;
  }

  if (filters.search) {
    where.OR = [
      { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      { pipedriveDeal: { title: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  const [total, data] = await prisma.$transaction([
    prisma.contractTracking.count({ where }),
    prisma.contractTracking.findMany({
      where,
      include: trackingInclude,
      orderBy: { createdAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
  ]);

  return {
    data,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

export async function findTrackingById(id: string) {
  return prisma.contractTracking.findUnique({
    where: { id },
    include: {
      ...trackingInclude,
      steps: {
        orderBy: { stepOrder: 'asc' },
        include: {
          assignedUser: { select: { id: true, name: true } },
          histories: {
            orderBy: { createdAt: 'desc' },
            include: { changedByUser: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
}

export async function findTrackingByDealId(pipedriveDealId: string) {
  return prisma.contractTracking.findUnique({ where: { pipedriveDealId } });
}

export async function createTrackingWithSteps(data: {
  customerId: string;
  pipedriveDealId: string;
  assignedUserId?: string;
  proposalAcceptedAt: Date;
  steps: {
    stepName: StepName;
    stepOrder: number;
    status: StepStatus;
    startedAt?: Date | null;
    dueAt?: Date | null;
    completedAt?: Date | null;
  }[];
}) {
  return prisma.contractTracking.create({
    data: {
      customerId: data.customerId,
      pipedriveDealId: data.pipedriveDealId,
      assignedUserId: data.assignedUserId,
      proposalAcceptedAt: data.proposalAcceptedAt,
      currentStep: StepName.CONTRACT_PREPARATION,
      overallStatus: ContractStatus.IN_PROGRESS,
      steps: {
        create: data.steps,
      },
    },
    include: { steps: true },
  });
}

export async function updateTrackingStatus(
  id: string,
  data: {
    currentStep?: StepName;
    overallStatus?: ContractStatus;
    assignedUserId?: string | null;
    completedAt?: Date | null;
  },
) {
  return prisma.contractTracking.update({ where: { id }, data });
}

export async function findStepById(stepId: string) {
  return prisma.contractStep.findUnique({
    where: { id: stepId },
    include: { contractTracking: true },
  });
}

export async function updateStep(
  stepId: string,
  data: {
    status?: StepStatus;
    startedAt?: Date | null;
    dueAt?: Date | null;
    completedAt?: Date | null;
    assignedUserId?: string | null;
    notes?: string | null;
  },
) {
  return prisma.contractStep.update({ where: { id: stepId }, data });
}

export async function createStepHistory(data: {
  contractStepId: string;
  fromStatus: string | null;
  toStatus: string;
  changedByUserId?: string | null;
  changeReason?: string | null;
  metadata?: object | null;
}) {
  return prisma.stepHistory.create({
    data: {
      contractStepId: data.contractStepId,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      changedByUserId: data.changedByUserId ?? null,
      changeReason: data.changeReason ?? null,
      metadata: data.metadata ?? undefined,
    },
  });
}

export async function findAllTrackingsForRecalculation() {
  return prisma.contractTracking.findMany({
    where: {
      overallStatus: { in: [ContractStatus.IN_PROGRESS, ContractStatus.DELAYED] },
    },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
    },
  });
}
