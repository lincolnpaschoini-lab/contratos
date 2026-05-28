import { prisma } from '../../../config/database';
import { markSigningComplete } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import crypto from 'crypto';

export interface ClicksignWebhookPayload {
  event?: {
    name?: string;
    data?: {
      document?: {
        key?: string;
        status?: string;
        filename?: string;
      };
      signer?: {
        key?: string;
        email?: string;
        name?: string;
      };
    };
  };
  // Formato alternativo (envelope)
  document?: {
    key?: string;
    status?: string;
  };
}

const SIGNED_EVENTS = ['sign', 'document_signed', 'all_signed', 'finalized'];
const SIGNED_STATUSES = ['signed', 'completed', 'finalized'];

export async function processClicksignWebhook(
  payload: ClicksignWebhookPayload,
  rawPayload: object,
) {
  const eventName = payload.event?.name ?? 'unknown';
  const documentKey =
    payload.event?.data?.document?.key ??
    payload.document?.key ??
    null;

  const eventId = `clicksign-${documentKey ?? 'noid'}-${eventName}-${Date.now()}`;

  // Idempotência: evita reprocessar o mesmo documento com mesmo evento
  if (documentKey) {
    const recent = await prisma.webhookEvent.findFirst({
      where: {
        source: 'clicksign',
        eventType: eventName,
        processed: true,
        createdAt: { gte: new Date(Date.now() - 60000) },
        payload: { path: ['event', 'data', 'document', 'key'], equals: documentKey },
      },
    });

    if (recent) {
      logger.info(`Webhook Clicksign duplicado ignorado para documento ${documentKey}`);
      return { skipped: true, reason: 'duplicado' };
    }
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      source: 'clicksign',
      externalEventId: eventId,
      eventType: eventName,
      payload: rawPayload as any,
      processed: false,
    },
  });

  try {
    const result = await handleClicksignEvent(payload, documentKey);

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processed: true, processedAt: new Date() },
    });

    return result;
  } catch (error: any) {
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { errorMessage: error.message ?? 'Erro desconhecido' },
    });
    throw error;
  }
}

async function handleClicksignEvent(
  payload: ClicksignWebhookPayload,
  documentKey: string | null,
) {
  const eventName = payload.event?.name ?? '';
  const documentStatus = payload.event?.data?.document?.status ?? payload.document?.status ?? '';

  const isSigningComplete =
    SIGNED_EVENTS.includes(eventName) || SIGNED_STATUSES.includes(documentStatus);

  if (!isSigningComplete || !documentKey) {
    return { skipped: true, reason: `evento ${eventName} não é de conclusão de assinatura` };
  }

  // Busca o documento no banco pelo identificador externo
  const doc = await prisma.clicksignDocument.findUnique({
    where: { externalDocumentId: documentKey },
  });

  if (!doc) {
    logger.warn(`Documento Clicksign ${documentKey} não encontrado no sistema`);
    return { skipped: true, reason: 'documento não encontrado' };
  }

  if (doc.signedAt) {
    logger.info(`Documento ${documentKey} já estava marcado como assinado`);
    return { skipped: true, reason: 'já assinado' };
  }

  // Marca o documento como assinado
  await prisma.clicksignDocument.update({
    where: { id: doc.id },
    data: {
      status: 'signed',
      signedAt: new Date(),
      rawPayload: payload as any,
    },
  });

  // Atualiza a etapa de assinatura no contrato
  await markSigningComplete(doc.contractTrackingId, documentKey);

  logger.info(`Assinatura Clicksign processada: documento ${documentKey}, tracking ${doc.contractTrackingId}`);
  return { processed: true, documentKey, trackingId: doc.contractTrackingId };
}

export function verifyClicksignToken(token: string | undefined): boolean {
  if (!env.CLICKSIGN_WEBHOOK_TOKEN) return true;
  return token === env.CLICKSIGN_WEBHOOK_TOKEN;
}
