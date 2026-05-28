import { ContractStatus, StepName, StepStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/middlewares/error.middleware';
import { addBusinessDays, isOverdue } from '../../shared/utils/business-days';
import { logger } from '../../config/logger';
import {
  findAllTrackings,
  findTrackingById,
  findStepById,
  updateStep,
  createStepHistory,
  updateTrackingStatus,
  createTrackingWithSteps,
  findAllTrackingsForRecalculation,
  ContractFilters,
} from './contracts.repository';
import { PaginationParams } from '../../shared/types';

const STEP_ORDER: StepName[] = [
  StepName.PROPOSAL_ACCEPTED,
  StepName.CONTRACT_PREPARATION,
  StepName.CONTRACT_SIGNING,
  StepName.CONTRACT_REGISTRATION,
  StepName.CONTRACT_BILLING,
];

async function getSlaMap(): Promise<Map<StepName, number>> {
  const rules = await prisma.slaRule.findMany({ where: { active: true } });
  return new Map(rules.map((r) => [r.stepName, r.businessDays]));
}

// ─── Criação via Pipedrive ────────────────────────────────────────────────────

export async function createContractFromDeal(params: {
  externalDealId: string;
  title: string;
  value: number;
  currency: string;
  stageName: string;
  stageId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerDocument?: string;
  rawPayload?: object;
  proposalAcceptedAt?: Date;
}) {
  const now = params.proposalAcceptedAt ?? new Date();
  const slaMap = await getSlaMap();

  // Upsert cliente
  const customer = await prisma.customer.upsert({
    where: {
      id: `ext-${params.externalDealId}`,
    },
    update: {},
    create: {
      id: `ext-${params.externalDealId}`,
      name: params.customerName,
      email: params.customerEmail,
      phone: params.customerPhone,
      document: params.customerDocument,
    },
  });

  // Cria o deal do Pipedrive
  const deal = await prisma.pipedriveDeal.create({
    data: {
      externalDealId: params.externalDealId,
      title: params.title,
      value: params.value,
      currency: params.currency,
      stageName: params.stageName,
      stageId: params.stageId,
      customerId: customer.id,
      rawPayload: params.rawPayload ?? {},
    },
  });

  // Prepara as etapas
  const proposalDue = addBusinessDays(now, slaMap.get(StepName.CONTRACT_PREPARATION) ?? 1);

  const steps = [
    {
      stepName: StepName.PROPOSAL_ACCEPTED,
      stepOrder: 1,
      status: StepStatus.COMPLETED,
      startedAt: now,
      completedAt: now,
      dueAt: null,
    },
    {
      stepName: StepName.CONTRACT_PREPARATION,
      stepOrder: 2,
      status: StepStatus.IN_PROGRESS,
      startedAt: now,
      dueAt: proposalDue,
      completedAt: null,
    },
    {
      stepName: StepName.CONTRACT_SIGNING,
      stepOrder: 3,
      status: StepStatus.PENDING,
      startedAt: null,
      dueAt: null,
      completedAt: null,
    },
    {
      stepName: StepName.CONTRACT_REGISTRATION,
      stepOrder: 4,
      status: StepStatus.PENDING,
      startedAt: null,
      dueAt: null,
      completedAt: null,
    },
    {
      stepName: StepName.CONTRACT_BILLING,
      stepOrder: 5,
      status: StepStatus.PENDING,
      startedAt: null,
      dueAt: null,
      completedAt: null,
    },
  ];

  const tracking = await createTrackingWithSteps({
    customerId: customer.id,
    pipedriveDealId: deal.id,
    proposalAcceptedAt: now,
    steps,
  });

  // Registra histórico da proposta aceita e preparação iniciada
  const proposalStep = tracking.steps.find((s) => s.stepName === StepName.PROPOSAL_ACCEPTED)!;
  const prepStep = tracking.steps.find((s) => s.stepName === StepName.CONTRACT_PREPARATION)!;

  await prisma.stepHistory.createMany({
    data: [
      {
        contractStepId: proposalStep.id,
        fromStatus: null,
        toStatus: StepStatus.COMPLETED,
        changeReason: 'Proposta aceita via Pipedrive',
        metadata: { source: 'pipedrive', externalDealId: params.externalDealId },
      },
      {
        contractStepId: prepStep.id,
        fromStatus: StepStatus.PENDING,
        toStatus: StepStatus.IN_PROGRESS,
        changeReason: 'Iniciado automaticamente após proposta aceita',
        metadata: { source: 'system' },
      },
    ],
  });

  logger.info(`Contrato criado para deal ${params.externalDealId}: tracking ${tracking.id}`);
  return tracking;
}

// ─── Listagem e detalhe ───────────────────────────────────────────────────────

export async function listContracts(filters: ContractFilters, pagination: PaginationParams) {
  return findAllTrackings(filters, pagination);
}

export async function getContractDetail(id: string) {
  const tracking = await findTrackingById(id);
  if (!tracking) throw new AppError('Contrato não encontrado.', 404);
  return tracking;
}

// ─── Atualização de etapas ────────────────────────────────────────────────────

export async function startStep(trackingId: string, stepId: string, userId: string) {
  const step = await findStepById(stepId);
  if (!step || step.contractTrackingId !== trackingId) {
    throw new AppError('Etapa não encontrada.', 404);
  }

  if (step.status !== StepStatus.PENDING) {
    throw new AppError('Esta etapa não pode ser iniciada neste momento.', 400);
  }

  // Valida que a etapa anterior está concluída
  const prevOrder = step.stepOrder - 1;
  if (prevOrder > 0) {
    const prevStep = await prisma.contractStep.findFirst({
      where: { contractTrackingId: trackingId, stepOrder: prevOrder },
    });
    if (prevStep && prevStep.status !== StepStatus.COMPLETED) {
      throw new AppError('A etapa anterior ainda não foi concluída.', 400);
    }
  }

  const slaMap = await getSlaMap();
  const dueAt = step.stepName !== StepName.PROPOSAL_ACCEPTED
    ? addBusinessDays(new Date(), slaMap.get(step.stepName) ?? 1)
    : null;

  await createStepHistory({
    contractStepId: stepId,
    fromStatus: step.status,
    toStatus: StepStatus.IN_PROGRESS,
    changedByUserId: userId,
    changeReason: 'Etapa iniciada manualmente',
  });

  await updateStep(stepId, {
    status: StepStatus.IN_PROGRESS,
    startedAt: new Date(),
    dueAt,
  });

  await updateTrackingStatus(trackingId, { currentStep: step.stepName });
  await recalculateOverallStatus(trackingId);
}

export async function completeStep(
  trackingId: string,
  stepId: string,
  userId: string,
  notes?: string,
) {
  const step = await findStepById(stepId);
  if (!step || step.contractTrackingId !== trackingId) {
    throw new AppError('Etapa não encontrada.', 404);
  }

  if (step.status === StepStatus.COMPLETED) {
    throw new AppError('Esta etapa já foi concluída.', 400);
  }

  if (step.status === StepStatus.PENDING) {
    throw new AppError('Inicie a etapa antes de concluí-la.', 400);
  }

  // Faturamento exige todas as anteriores concluídas
  if (step.stepName === StepName.CONTRACT_BILLING) {
    const prevSteps = await prisma.contractStep.findMany({
      where: { contractTrackingId: trackingId, stepOrder: { lt: step.stepOrder } },
    });
    const allDone = prevSteps.every((s) => s.status === StepStatus.COMPLETED);
    if (!allDone) throw new AppError('Todas as etapas anteriores devem estar concluídas antes do faturamento.', 400);
  }

  await createStepHistory({
    contractStepId: stepId,
    fromStatus: step.status,
    toStatus: StepStatus.COMPLETED,
    changedByUserId: userId,
    changeReason: notes ?? 'Etapa concluída manualmente',
  });

  await updateStep(stepId, {
    status: StepStatus.COMPLETED,
    completedAt: new Date(),
    notes: notes ?? step.notes,
  });

  // Inicia próxima etapa automaticamente se existir
  const currentIndex = STEP_ORDER.indexOf(step.stepName);
  const nextStepName = STEP_ORDER[currentIndex + 1];

  if (nextStepName) {
    const nextStep = await prisma.contractStep.findUnique({
      where: { contractTrackingId_stepName: { contractTrackingId: trackingId, stepName: nextStepName } },
    });

    if (nextStep && nextStep.status === StepStatus.PENDING) {
      // Próxima etapa ainda não iniciada — inicia automaticamente com SLA
      const slaMap = await getSlaMap();
      const dueAt = addBusinessDays(new Date(), slaMap.get(nextStepName) ?? 1);

      await createStepHistory({
        contractStepId: nextStep.id,
        fromStatus: StepStatus.PENDING,
        toStatus: StepStatus.IN_PROGRESS,
        changedByUserId: null,
        changeReason: `Iniciado automaticamente após conclusão de ${step.stepName}`,
        metadata: { source: 'system' },
      });

      await updateStep(nextStep.id, {
        status: StepStatus.IN_PROGRESS,
        startedAt: new Date(),
        dueAt,
      });
    }

    // Sempre avança o currentStep do tracking ao concluir uma etapa,
    // independente do status da próxima (pode já estar IN_PROGRESS ou DELAYED)
    await updateTrackingStatus(trackingId, { currentStep: nextStepName });
  }

  if (step.stepName === StepName.CONTRACT_BILLING) {
    await updateTrackingStatus(trackingId, {
      overallStatus: ContractStatus.COMPLETED,
      completedAt: new Date(),
    });
  } else {
    await recalculateOverallStatus(trackingId);
  }

  logger.info(`Etapa ${step.stepName} concluída por usuário ${userId} no contrato ${trackingId}`);
}

export async function assignStep(trackingId: string, stepId: string, assignedUserId: string, requesterId: string) {
  const step = await findStepById(stepId);
  if (!step || step.contractTrackingId !== trackingId) {
    throw new AppError('Etapa não encontrada.', 404);
  }

  await createStepHistory({
    contractStepId: stepId,
    fromStatus: step.status,
    toStatus: step.status,
    changedByUserId: requesterId,
    changeReason: `Responsável alterado`,
    metadata: { previousUserId: step.assignedUserId, newUserId: assignedUserId },
  });

  await updateStep(stepId, { assignedUserId });
}

export async function updateStepNotes(trackingId: string, stepId: string, notes: string, userId: string) {
  const step = await findStepById(stepId);
  if (!step || step.contractTrackingId !== trackingId) {
    throw new AppError('Etapa não encontrada.', 404);
  }

  await createStepHistory({
    contractStepId: stepId,
    fromStatus: step.status,
    toStatus: step.status,
    changedByUserId: userId,
    changeReason: 'Observação atualizada',
    metadata: { notes },
  });

  await updateStep(stepId, { notes });
}

export async function assignTracking(trackingId: string, assignedUserId: string, requesterId: string) {
  const tracking = await findTrackingById(trackingId);
  if (!tracking) throw new AppError('Contrato não encontrado.', 404);

  await updateTrackingStatus(trackingId, { assignedUserId });
  logger.info(`Contrato ${trackingId} atribuído ao usuário ${assignedUserId} por ${requesterId}`);
}

// ─── Recálculo de status ──────────────────────────────────────────────────────

export async function recalculateOverallStatus(trackingId: string) {
  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  });
  if (!tracking) return;

  const steps = tracking.steps;

  // Atualiza etapas com prazo vencido para DELAYED
  for (const step of steps) {
    const notDone = step.status === StepStatus.IN_PROGRESS || step.status === StepStatus.PENDING;
    if (notDone && isOverdue(step.dueAt)) {
      await updateStep(step.id, { status: StepStatus.DELAYED });
    }
  }

  // Recarrega após atualizar etapas atrasadas
  const freshSteps = await prisma.contractStep.findMany({
    where: { contractTrackingId: trackingId },
    orderBy: { stepOrder: 'asc' },
  });

  const allCompleted = freshSteps.every((s) => s.status === StepStatus.COMPLETED);
  const hasDelayed = freshSteps.some((s) => s.status === StepStatus.DELAYED);

  let newStatus: ContractStatus;
  if (allCompleted) {
    newStatus = ContractStatus.COMPLETED;
  } else if (hasDelayed) {
    newStatus = ContractStatus.DELAYED;
  } else {
    newStatus = ContractStatus.IN_PROGRESS;
  }

  // Deriva o currentStep correto: primeira etapa não concluída (em ordem)
  const firstActiveStep = freshSteps.find((s) => s.status !== StepStatus.COMPLETED);
  const correctCurrentStep = firstActiveStep
    ? firstActiveStep.stepName
    : freshSteps[freshSteps.length - 1].stepName;

  const updates: Parameters<typeof updateTrackingStatus>[1] = {};
  if (newStatus !== tracking.overallStatus) updates.overallStatus = newStatus;
  if (correctCurrentStep !== tracking.currentStep) updates.currentStep = correctCurrentStep;
  if (allCompleted && !tracking.completedAt) updates.completedAt = new Date();

  if (Object.keys(updates).length > 0) {
    await updateTrackingStatus(trackingId, updates);
  }
}

// ─── Job: recalcula todos os atrasos ─────────────────────────────────────────

export async function recalculateAllDelays() {
  const trackings = await findAllTrackingsForRecalculation();
  let updated = 0;

  for (const tracking of trackings) {
    for (const step of tracking.steps) {
      const notDoneJob = step.status === StepStatus.IN_PROGRESS || step.status === StepStatus.PENDING;
      if (notDoneJob && isOverdue(step.dueAt)) {
        await updateStep(step.id, { status: StepStatus.DELAYED });
        updated++;
      }
    }
    await recalculateOverallStatus(tracking.id);
  }

  if (updated > 0) {
    logger.info(`Recálculo de SLA: ${updated} etapa(s) marcada(s) como atrasada(s).`);
  }

  return { processed: trackings.length, updated };
}

// ─── Atualização via Clicksign ────────────────────────────────────────────────

export async function markSigningComplete(trackingId: string, externalDocumentId: string) {
  const step = await prisma.contractStep.findUnique({
    where: {
      contractTrackingId_stepName: {
        contractTrackingId: trackingId,
        stepName: StepName.CONTRACT_SIGNING,
      },
    },
  });

  if (!step || step.status === StepStatus.COMPLETED) return;

  await createStepHistory({
    contractStepId: step.id,
    fromStatus: step.status,
    toStatus: StepStatus.COMPLETED,
    changedByUserId: null,
    changeReason: 'Assinatura concluída via Clicksign',
    metadata: { source: 'clicksign', externalDocumentId },
  });

  await updateStep(step.id, { status: StepStatus.COMPLETED, completedAt: new Date() });

  // Inicia o cadastro automaticamente
  const registrationStep = await prisma.contractStep.findUnique({
    where: {
      contractTrackingId_stepName: {
        contractTrackingId: trackingId,
        stepName: StepName.CONTRACT_REGISTRATION,
      },
    },
  });

  if (registrationStep && registrationStep.status === StepStatus.PENDING) {
    const slaMap = await getSlaMap();
    const dueAt = addBusinessDays(new Date(), slaMap.get(StepName.CONTRACT_REGISTRATION) ?? 1);

    await createStepHistory({
      contractStepId: registrationStep.id,
      fromStatus: StepStatus.PENDING,
      toStatus: StepStatus.IN_PROGRESS,
      changedByUserId: null,
      changeReason: 'Iniciado automaticamente após assinatura Clicksign',
      metadata: { source: 'system' },
    });

    await updateStep(registrationStep.id, {
      status: StepStatus.IN_PROGRESS,
      startedAt: new Date(),
      dueAt,
    });

    await updateTrackingStatus(trackingId, { currentStep: StepName.CONTRACT_REGISTRATION });
  }

  await recalculateOverallStatus(trackingId);
  logger.info(`Assinatura Clicksign processada para tracking ${trackingId}`);
}
