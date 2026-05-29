import { prisma } from '../../../config/database';
import { markSigningComplete } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import crypto from 'crypto';
import {
  createEnvelope,
  addDocumentFromTemplate,
  addSigner,
  addRequirement,
  activateEnvelope,
  getEnvelope,
  type ClicksignSigner,
} from './clicksign.api';

// Mapeamento tipo_servico (campo Pipedrive) → chave do template no Clicksign
const TEMPLATE_MAP: Record<string, string> = {
  'Continuado PF': 'dc4fdb62-cd1c-4e4a-b6ce-d393b5d06c80',
  'Continuado PJ': '29878949-500b-468d-a62e-e98a7f9bed3f',
};

function getInternalSigners(): Array<{ name: string; email: string }> {
  const emails = env.CLICKSIGN_INTERNAL_SIGNER_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
  const names = env.CLICKSIGN_INTERNAL_SIGNER_NAMES.split(',').map((n) => n.trim()).filter(Boolean);
  return emails.map((email, i) => ({ email, name: names[i] ?? email }));
}

export async function sendContractToClicksign(params: {
  trackingId: string;
  tipoServico: string | null | undefined;
  customerName: string;
  customerEmail: string;
}): Promise<{ sent: boolean; envelopeId?: string; reason?: string }> {
  const { trackingId, tipoServico, customerName, customerEmail } = params;

  console.log(`[CLICKSIGN] Iniciando envio — tracking: ${trackingId}, tipoServico: ${tipoServico}, cliente: ${customerEmail}`);

  if (!env.CLICKSIGN_API_KEY) {
    console.log('[CLICKSIGN] ERRO: CLICKSIGN_API_KEY não configurada');
    logger.warn('Clicksign: CLICKSIGN_API_KEY não configurada — envio ignorado');
    return { sent: false, reason: 'API key não configurada' };
  }

  const templateKey = tipoServico ? TEMPLATE_MAP[tipoServico] : undefined;
  if (!templateKey) {
    console.log(`[CLICKSIGN] AVISO: tipo_servico "${tipoServico}" sem template mapeado — disponíveis: ${Object.keys(TEMPLATE_MAP).join(', ')}`);
    logger.warn(`Clicksign: tipo_servico "${tipoServico}" sem template mapeado — envio ignorado`);
    return { sent: false, reason: `tipo_servico "${tipoServico}" sem template configurado` };
  }

  console.log(`[CLICKSIGN] Template selecionado: ${templateKey}`);

  // 1 — Criar envelope
  const envelopeName = `${tipoServico} — ${customerName}`;
  const message = `Prezado(a), segue o contrato de serviço ${tipoServico} para sua assinatura.`;
  const envelopeId = await createEnvelope(envelopeName, message);
  console.log(`[CLICKSIGN] Envelope criado: ${envelopeId}`);

  // 2 — Adicionar documento do template
  const filename = `contrato_${Date.now()}.pdf`;
  const documentId = await addDocumentFromTemplate(envelopeId, templateKey, filename);
  console.log(`[CLICKSIGN] Documento adicionado: ${documentId}`);

  // 3 — Adicionar signatários (internos + cliente)
  const allSigners: ClicksignSigner[] = [
    ...getInternalSigners(),
    { name: customerName, email: customerEmail },
  ];

  console.log(`[CLICKSIGN] Adicionando ${allSigners.length} signatário(s): ${allSigners.map(s => s.email).join(', ')}`);

  const signerIds: string[] = [];
  for (const signer of allSigners) {
    const signerId = await addSigner(envelopeId, signer);
    signerIds.push(signerId);
    console.log(`[CLICKSIGN] Signatário adicionado: ${signer.email} (id: ${signerId})`);
  }

  // 4 — Requisitos de assinatura: vincula cada signatário ao documento via email
  for (const signerId of signerIds) {
    await addRequirement(envelopeId, documentId, signerId);
  }
  console.log(`[CLICKSIGN] ${signerIds.length} requisito(s) de assinatura criado(s)`);

  // 5 — Ativar envelope (draft → running) — dispara emails para os signatários
  await activateEnvelope(envelopeId);
  console.log(`[CLICKSIGN] Envelope ativado (running): ${envelopeId}`);

  // Salva no banco para rastreamento
  await prisma.clicksignDocument.create({
    data: {
      contractTrackingId: trackingId,
      externalEnvelopeId: envelopeId,
      externalDocumentId: documentId,
      status: 'running',
      sentAt: new Date(),
      rawPayload: { envelopeId, documentId, signerIds, templateKey } as any,
    },
  });

  console.log(`[CLICKSIGN] Envio concluído — tracking: ${trackingId}, envelope: ${envelopeId}`);
  logger.info(`Clicksign: envio concluído — tracking ${trackingId}, envelope ${envelopeId}`);
  return { sent: true, envelopeId };
}

/** Envia manualmente para o Clicksign um contrato já em Assinatura. */
export async function sendContractToClicksignManual(trackingId: string): Promise<{ sent: boolean; envelopeId?: string; reason?: string }> {
  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: {
      customer: true,
      pipedriveDeal: true,
      clicksignDocs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!tracking) return { sent: false, reason: 'Contrato não encontrado' };
  if (tracking.clicksignDocs.length > 0) return { sent: false, reason: 'Já existe um envelope Clicksign para este contrato' };

  const customer = tracking.customer as any;
  const customerEmail = customer?.contactEmail ?? customer?.email ?? null;
  if (!customerEmail) return { sent: false, reason: 'Cliente sem email cadastrado' };

  const tipoServico = (tracking.pipedriveDeal as any)?.tipoServico ?? null;

  return sendContractToClicksign({
    trackingId,
    tipoServico,
    customerName: customer?.name ?? 'Cliente',
    customerEmail,
  });
}

/** Consulta o status atual do envelope no Clicksign e atualiza o banco. */
export async function refreshClicksignStatus(trackingId: string): Promise<{
  status: string;
  envelopeId: string;
} | null> {
  const doc = await prisma.clicksignDocument.findFirst({
    where: { contractTrackingId: trackingId },
    orderBy: { createdAt: 'desc' },
  });

  if (!doc?.externalEnvelopeId) return null;

  const envelope = await getEnvelope(doc.externalEnvelopeId);
  const newStatus = envelope.data.attributes.status;

  await prisma.clicksignDocument.update({
    where: { id: doc.id },
    data: { status: newStatus },
  });

  logger.info(`Clicksign: status atualizado — envelope ${doc.externalEnvelopeId}: ${newStatus}`);
  return { status: newStatus, envelopeId: doc.externalEnvelopeId };
}

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
