import { prisma } from '../../../config/database';
import { createContractFromDeal } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import {
  fetchOrganization,
  fetchPerson,
  fetchOrganizationFields,
  fetchPipedriveUser,
  extractPrimaryEmail,
  extractPrimaryPhone,
  extractAddress,
  buildLabeledFields,
  detectDocument,
} from './pipedrive.api';

// Suporta formato v1 (event + current) e v2 (meta.action + data)
export interface PipedriveWebhookPayload {
  // v1
  event?: string;
  current?: DealData;
  // v2
  data?: DealData;
  meta?: {
    id?: number | string;
    action?: string;
    entity?: string;
    object?: string;
    version?: string;
    entity_id?: string;
    user_id?: string | number;
  };
  previous?: {
    stage_id?: number | string;
    stage_name?: string;
  };
}

interface DealData {
  id?: number | string;
  title?: string;
  value?: number;
  currency?: string;
  stage_id?: number | string;
  stage_name?: string;
  person_name?: string;
  org_name?: string;
  person_id?: number;
  org_id?: number;
  pipeline_id?: number;
  status?: string;
}

// Normaliza payload v1 e v2 para uma estrutura única
function normalizePipedrivePayload(payload: PipedriveWebhookPayload) {
  const dealData = payload.current ?? payload.data ?? {};
  const dealId = dealData.id ?? payload.meta?.entity_id;
  const eventType = payload.event ?? `${payload.meta?.action ?? 'change'}.${payload.meta?.entity ?? payload.meta?.object ?? 'deal'}`;

  return { dealData, dealId: dealId ? String(dealId) : null, eventType };
}

export async function processPipedriveWebhook(
  payload: PipedriveWebhookPayload,
  rawPayload: object,
  existingEventId?: string | null,
) {
  const { eventType } = normalizePipedrivePayload(payload);

  let webhookEventId = existingEventId;

  if (!webhookEventId) {
    const metaId = payload.meta?.id ?? Date.now();
    const externalEventId = `pipedrive-${metaId}-${eventType}`;

    const existing = await prisma.webhookEvent.findFirst({
      where: { source: 'pipedrive', externalEventId, processed: true },
    });
    if (existing) {
      logger.info(`Webhook Pipedrive duplicado ignorado: ${externalEventId}`);
      return { skipped: true, reason: 'duplicado' };
    }

    const saved = await prisma.webhookEvent.create({
      data: {
        source: 'pipedrive',
        externalEventId,
        eventType,
        payload: rawPayload as any,
        processed: false,
      },
    });
    webhookEventId = saved.id;
  }

  try {
    const result = await handleDealUpdate(payload);

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processed: true, processedAt: new Date() },
    });

    logger.info(`Webhook Pipedrive processado: ${result.skipped ? 'ignorado' : 'criado'}`, result);
    return result;
  } catch (error: any) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { errorMessage: error.message ?? 'Erro desconhecido' },
    }).catch(() => {});
    throw error;
  }
}

async function handleDealUpdate(payload: PipedriveWebhookPayload) {
  const { dealData, dealId } = normalizePipedrivePayload(payload);

  if (!dealId) {
    return { skipped: true, reason: 'sem deal ID no payload' };
  }

  const currentStageId = String(dealData.stage_id ?? '');
  const previousStageId = String(payload.previous?.stage_id ?? '');
  const proposalStageId = env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID;
  const prepStageId = env.PIPEDRIVE_CONTRACT_PREPARATION_STAGE_ID;
  const signingStageId = env.PIPEDRIVE_CONTRACT_SIGNING_STAGE_ID;
  const pipedriveUserId = payload.meta?.user_id;

  logger.info(`Pipedrive deal ${dealId}: stage ${previousStageId} → ${currentStageId}`);

  // ── Estágio "Assinatura do Contrato" (57): avança contrato existente ─────
  if (signingStageId && currentStageId === signingStageId && previousStageId !== signingStageId) {
    return handleMoveToSigning(dealId, dealData, pipedriveUserId);
  }

  // ── Estágio "Preparação do Contrato" (56): avança contrato existente ──────
  if (prepStageId && currentStageId === prepStageId && previousStageId !== prepStageId) {
    return handleMoveToPreparation(dealId, dealData, pipedriveUserId);
  }

  // ── Estágio "Proposta Aceita" (55): cria novo contrato ───────────────────
  const isProposalAccepted = proposalStageId
    ? currentStageId === proposalStageId && previousStageId !== proposalStageId
    : (dealData.stage_name?.toLowerCase().includes('proposta aceita') ?? false);

  if (!isProposalAccepted) {
    return { skipped: true, reason: `estágio ${currentStageId} não mapeado` };
  }

  // Verifica duplicidade
  const existingDeal = await prisma.pipedriveDeal.findUnique({ where: { externalDealId: dealId } });
  if (existingDeal) {
    logger.info(`Deal Pipedrive ${dealId} já possui tracking — ignorado.`);
    return { skipped: true, reason: 'deal já processado anteriormente' };
  }

  // Busca dados enriquecidos em paralelo: org, pessoa e campos de org
  const [org, person, orgFields] = await Promise.all([
    dealData.org_id ? fetchOrganization(dealData.org_id) : Promise.resolve(null),
    dealData.person_id ? fetchPerson(dealData.person_id) : Promise.resolve(null),
    fetchOrganizationFields(),
  ]);

  const titleFallback = (dealData.title ?? '').replace(/\|.*$/, '').trim() || `Lead #${dealId}`;
  const customerName = org?.name ?? titleFallback;
  const addrData = org ? extractAddress(org) : { address: null, city: null, state: null, zipCode: null, country: null };

  // Detecta CNPJ nos campos customizados da org
  const detectedDocument = org ? detectDocument(org as Record<string, unknown>, orgFields) : null;
  const orgLabeled = org ? buildLabeledFields(org as Record<string, unknown>, orgFields) : null;
  const enrichedOrgRaw = org ? { ...org, _labeled: orgLabeled } : null;

  await createContractFromDeal({
    externalDealId: dealId,
    title: dealData.title ?? `Negócio ${dealId}`,
    value: dealData.value ?? 0,
    currency: dealData.currency ?? 'BRL',
    stageName: dealData.stage_name ?? 'Proposta aceita',
    stageId: currentStageId,
    rawPayload: payload as object,
    proposalAcceptedAt: new Date(),

    customerName,
    customerEmail: extractPrimaryEmail(org?.email) ?? undefined,
    customerPhone: extractPrimaryPhone(org?.phone) ?? undefined,
    customerAddress: addrData.address ?? undefined,
    customerCity: addrData.city ?? undefined,
    customerState: addrData.state ?? undefined,
    customerZipCode: addrData.zipCode ?? undefined,
    customerDocument: detectedDocument ?? undefined,
    customerCountry: addrData.country ?? undefined,
    pipedriveOrgId: dealData.org_id ? String(dealData.org_id) : undefined,
    pipedriveOrgRaw: enrichedOrgRaw as object ?? undefined,

    // Dados do contato (v2 usa "emails"/"phones" no plural)
    contactName: person?.name ?? undefined,
    contactEmail: extractPrimaryEmail(person?.emails ?? person?.email) ?? undefined,
    contactPhone: extractPrimaryPhone(person?.phones ?? person?.phone) ?? undefined,
    pipedrivePersonId: dealData.person_id ? String(dealData.person_id) : undefined,
    pipedrivePersonRaw: person ? (person as unknown as object) : undefined,
  });

  logger.info(`Contrato criado para deal Pipedrive ${dealId}: "${dealData.title}" — org: ${org?.name ?? 'sem org'}, pessoa: ${person?.name ?? 'sem pessoa'}`);
  return { created: true, externalDealId: dealId };
}

async function handleMoveToPreparation(dealId: string, dealData: DealData, pipedriveUserId?: string | number) {
  const existingDeal = await prisma.pipedriveDeal.findUnique({
    where: { externalDealId: dealId },
    include: { contractTracking: { include: { steps: true } } },
  });

  if (!existingDeal?.contractTracking) {
    logger.warn(`Pipedrive: deal ${dealId} movido para Preparação mas não tem tracking no sistema`);
    return { skipped: true, reason: 'deal não possui contrato no sistema' };
  }

  const tracking = existingDeal.contractTracking;
  const { StepStatus } = await import('@prisma/client');
  const { startStep } = await import('../../contracts/contracts.service');

  const prepStep = tracking.steps.find((s) => s.stepName === 'CONTRACT_PREPARATION');
  if (!prepStep) {
    return { skipped: true, reason: 'etapa de preparação não encontrada' };
  }

  if (prepStep.status !== StepStatus.PENDING) {
    logger.info(`Deal ${dealId}: Preparação já foi iniciada (status: ${prepStep.status})`);
    return { skipped: true, reason: `preparação já em status ${prepStep.status}` };
  }

  const pipedriveUser = pipedriveUserId ? await fetchPipedriveUser(pipedriveUserId) : null;
  const stepMetadata = { source: 'pipedrive', ...(pipedriveUser && { pipedriveUser: { id: pipedriveUserId, name: pipedriveUser.name } }) };

  await startStep(tracking.id, prepStep.id, 'system-pipedrive', stepMetadata);
  logger.info(`Deal ${dealId}: Preparação do Contrato iniciada via Pipedrive (estágio ${dealData.stage_id}) por ${pipedriveUser?.name ?? pipedriveUserId ?? 'desconhecido'}`);

  return { advanced: true, trackingId: tracking.id, step: 'CONTRACT_PREPARATION' };
}

async function handleMoveToSigning(dealId: string, dealData: DealData, pipedriveUserId?: string | number) {
  const existingDeal = await prisma.pipedriveDeal.findUnique({
    where: { externalDealId: dealId },
    include: { contractTracking: { include: { steps: true } } },
  });

  if (!existingDeal?.contractTracking) {
    logger.warn(`Pipedrive: deal ${dealId} movido para Assinatura mas não tem tracking no sistema`);
    return { skipped: true, reason: 'deal não possui contrato no sistema' };
  }

  const tracking = existingDeal.contractTracking;
  const { StepStatus } = await import('@prisma/client');
  const { startStep, completeStep } = await import('../../contracts/contracts.service');

  const signingStep = tracking.steps.find((s) => s.stepName === 'CONTRACT_SIGNING');
  if (!signingStep) {
    return { skipped: true, reason: 'etapa de assinatura não encontrada' };
  }

  if (signingStep.status !== StepStatus.PENDING) {
    logger.info(`Deal ${dealId}: Assinatura já iniciada (status: ${signingStep.status})`);
    return { skipped: true, reason: `assinatura já em status ${signingStep.status}` };
  }

  const pipedriveUser = pipedriveUserId ? await fetchPipedriveUser(pipedriveUserId) : null;
  const stepMetadata = { source: 'pipedrive', ...(pipedriveUser && { pipedriveUser: { id: pipedriveUserId, name: pipedriveUser.name } }) };

  // Garante que Preparação está concluída antes de iniciar Assinatura.
  // completeStep auto-inicia a próxima etapa (Assinatura), evitando dupla chamada.
  const prepStep = tracking.steps.find((s) => s.stepName === 'CONTRACT_PREPARATION');
  if (prepStep) {
    if (prepStep.status === StepStatus.PENDING) {
      await startStep(tracking.id, prepStep.id, 'system-pipedrive', stepMetadata);
      await completeStep(tracking.id, prepStep.id, 'system-pipedrive', 'Preparação concluída via mudança de estágio no Pipedrive', stepMetadata);
    } else if (prepStep.status === StepStatus.IN_PROGRESS) {
      await completeStep(tracking.id, prepStep.id, 'system-pipedrive', 'Preparação concluída via mudança de estágio no Pipedrive', stepMetadata);
    }
    // Se já estava COMPLETED, CONTRACT_SIGNING continua PENDING e cai no startStep abaixo
  }

  // Se completeStep já auto-iniciou a Assinatura, não chama startStep novamente
  const freshSigning = await prisma.contractStep.findUnique({ where: { id: signingStep.id } });
  if (freshSigning && freshSigning.status === StepStatus.PENDING) {
    await startStep(tracking.id, signingStep.id, 'system-pipedrive', stepMetadata);
  }

  logger.info(`Deal ${dealId}: Assinatura do Contrato iniciada via Pipedrive (estágio ${dealData.stage_id}) por ${pipedriveUser?.name ?? pipedriveUserId ?? 'desconhecido'}`);
  return { advanced: true, trackingId: tracking.id, step: 'CONTRACT_SIGNING' };
}

export function verifyPipedriveSignature(rawBody: string, signature: string): boolean {
  if (!env.PIPEDRIVE_WEBHOOK_SECRET) return true;
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', env.PIPEDRIVE_WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
