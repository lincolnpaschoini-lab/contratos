import { prisma } from '../../../config/database';
import { createContractFromDeal } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';

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

  const targetStageId = env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID;
  const currentStageId = String(dealData.stage_id ?? '');
  const previousStageId = String(payload.previous?.stage_id ?? '');

  logger.info(`Pipedrive deal ${dealId}: stage ${previousStageId} → ${currentStageId} (alvo: ${targetStageId || 'nome'})`);

  // Verifica se entrou no estágio alvo
  const isProposalAccepted = targetStageId
    ? currentStageId === targetStageId && previousStageId !== targetStageId
    : (dealData.stage_name?.toLowerCase().includes('proposta aceita') ?? false);

  if (!isProposalAccepted) {
    return { skipped: true, reason: `estágio ${currentStageId} não é o alvo (${targetStageId || 'proposta aceita'})` };
  }

  // Verifica duplicidade
  const existingDeal = await prisma.pipedriveDeal.findUnique({ where: { externalDealId: dealId } });
  if (existingDeal) {
    logger.info(`Deal Pipedrive ${dealId} já possui tracking — ignorado.`);
    return { skipped: true, reason: 'deal já processado anteriormente' };
  }

  // Busca nome do cliente — org tem prioridade sobre person
  let customerName = `Lead #${dealId}`;
  if (dealData.org_id) {
    try {
      // Tenta buscar nome da organização via API se token disponível
      customerName = await fetchOrgName(dealData.org_id) ?? customerName;
    } catch { /* usa fallback */ }
  }
  // Se não resolveu, usa o título do deal
  if (customerName === `Lead #${dealId}`) {
    customerName = (dealData.title ?? customerName).replace(/\|.*$/, '').trim() || customerName;
  }

  await createContractFromDeal({
    externalDealId: dealId,
    title: dealData.title ?? `Negócio ${dealId}`,
    value: dealData.value ?? 0,
    currency: dealData.currency ?? 'BRL',
    stageName: dealData.stage_name ?? 'Proposta aceita',
    stageId: currentStageId,
    customerName,
    rawPayload: payload as object,
    proposalAcceptedAt: new Date(),
  });

  logger.info(`Contrato criado para deal Pipedrive ${dealId}: "${dealData.title}"`);
  return { created: true, externalDealId: dealId };
}

async function fetchOrgName(orgId: number | string): Promise<string | null> {
  if (!env.PIPEDRIVE_API_TOKEN || !env.PIPEDRIVE_DOMAIN) return null;
  try {
    const res = await fetch(
      `https://${env.PIPEDRIVE_DOMAIN}/api/v2/organizations/${orgId}?api_token=${env.PIPEDRIVE_API_TOKEN}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    return json?.data?.name ?? null;
  } catch {
    return null;
  }
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
