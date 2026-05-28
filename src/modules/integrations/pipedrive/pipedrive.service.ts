import { prisma } from '../../../config/database';
import { createContractFromDeal } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';

export interface PipedriveWebhookPayload {
  event: string;
  meta?: {
    id?: number;
    action?: string;
    object?: string;
  };
  current?: {
    id?: number;
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
  };
  previous?: {
    stage_id?: number | string;
    stage_name?: string;
  };
}

export async function processPipedriveWebhook(
  payload: PipedriveWebhookPayload,
  rawPayload: object,
  existingEventId?: string | null,
) {
  // Usa o evento já salvo pelo controller, ou cria um novo se chamado diretamente (testes)
  let webhookEventId = existingEventId;

  if (!webhookEventId) {
    const eventId = `pipedrive-${payload.meta?.id ?? Date.now()}-${payload.event ?? 'unknown'}`;

    const existing = await prisma.webhookEvent.findFirst({
      where: { source: 'pipedrive', externalEventId: eventId, processed: true },
    });
    if (existing) {
      logger.info(`Webhook Pipedrive duplicado ignorado: ${eventId}`);
      return { skipped: true, reason: 'duplicado' };
    }

    const saved = await prisma.webhookEvent.create({
      data: {
        source: 'pipedrive',
        externalEventId: eventId,
        eventType: payload.event ?? 'unknown',
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

    return result;
  } catch (error: any) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { errorMessage: error.message ?? 'Erro desconhecido' },
    }).catch(() => {}); // não propaga erro de update
    throw error;
  }
}

async function handleDealUpdate(payload: PipedriveWebhookPayload) {
  const current = payload.current;
  if (!current?.id) {
    return { skipped: true, reason: 'sem deal atual' };
  }

  const targetStageId = env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID;

  const currentStageId = String(current.stage_id ?? '');
  const previousStageId = String(payload.previous?.stage_id ?? '');

  // Só processa se o negócio acabou de entrar no estágio alvo
  const isProposalAccepted =
    targetStageId
      ? currentStageId === targetStageId && previousStageId !== targetStageId
      : current.stage_name?.toLowerCase().includes('proposta aceita');

  if (!isProposalAccepted) {
    return { skipped: true, reason: `estágio ${currentStageId} não é alvo` };
  }

  const externalDealId = String(current.id);

  // Verifica se já existe um tracking para este deal
  const existingDeal = await prisma.pipedriveDeal.findUnique({ where: { externalDealId } });
  if (existingDeal) {
    logger.info(`Deal Pipedrive ${externalDealId} já possui tracking — ignorado.`);
    return { skipped: true, reason: 'deal já processado' };
  }

  const customerName = current.org_name ?? current.person_name ?? `Lead #${current.id}`;

  await createContractFromDeal({
    externalDealId,
    title: current.title ?? `Negócio ${externalDealId}`,
    value: current.value ?? 0,
    currency: current.currency ?? 'BRL',
    stageName: current.stage_name ?? 'Proposta aceita',
    stageId: currentStageId,
    customerName,
    rawPayload: payload as object,
    proposalAcceptedAt: new Date(),
  });

  logger.info(`Contrato criado para deal Pipedrive ${externalDealId}: "${current.title}"`);
  return { created: true, externalDealId };
}

// ─── Verificação de assinatura HMAC (opcional, se o Pipedrive suportar) ───────

export function verifyPipedriveSignature(rawBody: string, signature: string): boolean {
  if (!env.PIPEDRIVE_WEBHOOK_SECRET) return true;

  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', env.PIPEDRIVE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
