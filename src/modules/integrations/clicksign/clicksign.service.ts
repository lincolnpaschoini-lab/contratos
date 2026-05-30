import { prisma } from '../../../config/database';
import { markSigningComplete } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import {
  createEnvelope,
  addDocumentFromTemplate,
  addSigner,
  addRequirement,
  activateEnvelope,
  getEnvelope,
  listEnvelopeSigners,
  type ClicksignSigner,
  type ClicksignSignerDetail,
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

  // Busca dados completos do cliente para preencher variáveis do template
  const fullTracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: { customer: true },
  });
  const c = fullTracking?.customer as any;
  const isPF = tipoServico?.includes('PF') ?? false;

  // Mapeamento das variáveis do template Clicksign com os dados do contrato
  // Os nomes das variáveis devem corresponder exatamente ao que está definido no template
  const templateData: Record<string, string> = {
    // ─── Dados pessoais (Continuado PF) ──────────────────────────
    'Nome':           isPF ? (c?.contactName ?? c?.name ?? '') : (c?.name ?? ''),
    'CPF':            isPF ? (c?.document ?? '') : '',
    'E-mail':         isPF ? (c?.contactEmail ?? c?.email ?? '') : (c?.email ?? c?.contactEmail ?? ''),
    'Telefone':       c?.contactPhone ?? c?.phone ?? '',
    'Celular':        c?.contactPhone ?? c?.phone ?? '',
    'WhatsApp':       c?.contactPhone ?? c?.phone ?? '',
    // Campos não disponíveis no sistema — ficam em branco para preenchimento manual
    'RG':             '',
    'Data_expedição': '',
    'Data_Nascimento':'',
    'Estado_Civil':   '',
    'Nacionalidade':  '',
    'Profissão':      '',
    // ─── Dados da empresa (Continuado PJ) ────────────────────────
    'Razão_Social':   !isPF ? (c?.name ?? '') : '',
    'CNPJ':           !isPF ? (c?.document ?? '') : '',
    // ─── Endereço (comum a PF e PJ) ──────────────────────────────
    'Logradouro':     c?.address ?? '',
    'Número':         '',
    'Complemento':    '',
    'Bairro':         '',
    'Cidade':         c?.city ?? '',
    'Estado':         c?.state ?? '',
    'CEP':            c?.zipCode ?? '',
  };

  console.log(`[CLICKSIGN] Variáveis do template: ${Object.entries(templateData).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  // 1 — Criar envelope
  const envelopeName = `${tipoServico} — ${customerName}`;
  const message = `Prezado(a), segue o contrato de serviço ${tipoServico} para sua assinatura.`;
  const envelopeId = await createEnvelope(envelopeName, message);
  console.log(`[CLICKSIGN] Envelope criado: ${envelopeId}`);

  // 2 — Adicionar documento do template com variáveis preenchidas
  const filename = `contrato_${Date.now()}.docx`;
  const documentId = await addDocumentFromTemplate(envelopeId, templateKey, filename, templateData);
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

  // Salva no banco com detalhes dos signatários para exibir na tela
  const signerDetails = allSigners.map((s, i) => ({
    id: signerIds[i],
    name: s.name,
    email: s.email,
    status: 'pending',
    signed_at: null,
  }));

  await prisma.clicksignDocument.create({
    data: {
      contractTrackingId: trackingId,
      externalEnvelopeId: envelopeId,
      externalDocumentId: documentId,
      status: 'running',
      sentAt: new Date(),
      rawPayload: { envelopeId, documentId, signers: signerDetails, templateKey } as any,
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

/** Consulta o status atual do envelope + signatários no Clicksign e atualiza o banco. */
export async function refreshClicksignStatus(trackingId: string): Promise<{
  status: string;
  envelopeId: string;
  signers: ClicksignSignerDetail[];
} | null> {
  const doc = await prisma.clicksignDocument.findFirst({
    where: { contractTrackingId: trackingId },
    orderBy: { createdAt: 'desc' },
  });

  if (!doc?.externalEnvelopeId) return null;

  const [envelope, signers] = await Promise.all([
    getEnvelope(doc.externalEnvelopeId),
    listEnvelopeSigners(doc.externalEnvelopeId),
  ]);

  const newStatus = envelope.data.attributes.status;
  const rawPayload = (doc.rawPayload as any) ?? {};

  await prisma.clicksignDocument.update({
    where: { id: doc.id },
    data: {
      status: newStatus,
      rawPayload: { ...rawPayload, signers } as any,
    },
  });

  // Se envelope fechado (todos assinaram) e ainda não foi marcado, avança o contrato
  if (newStatus === 'closed' && !doc.signedAt) {
    await prisma.clicksignDocument.update({
      where: { id: doc.id },
      data: { signedAt: new Date() },
    });
    await markSigningComplete(trackingId, doc.externalDocumentId ?? doc.externalEnvelopeId);
    logger.info(`Clicksign: envelope ${doc.externalEnvelopeId} fechado — contrato avançado para Cadastro`);
  }

  logger.info(`Clicksign: status ${newStatus}, ${signers.length} signatário(s)`);
  return { status: newStatus, envelopeId: doc.externalEnvelopeId, signers };
}

export interface ClicksignWebhookPayload {
  // Formato v1
  event?: {
    name?: string;
    data?: {
      document?: { key?: string; status?: string; filename?: string };
      signer?: { key?: string; email?: string; name?: string };
      envelope?: { key?: string; status?: string };
    };
  };
  document?: { key?: string; status?: string };
  // Formato v3 JSON:API
  data?: {
    type?: string;
    id?: string;
    attributes?: { status?: string; [key: string]: unknown };
  };
}

// Eventos que indicam conclusão TOTAL (todos assinaram)
const COMPLETED_EVENTS = ['auto_close', 'document_closed', 'all_signed', 'finalized', 'envelope_finalized'];
// Eventos de assinatura individual (apenas UM signatário assinou)
const INDIVIDUAL_SIGN_EVENTS = ['sign', 'document_signed'];
const ENVELOPE_CLOSED_STATUSES = ['closed', 'finalized'];

export async function processClicksignWebhook(payload: ClicksignWebhookPayload, rawPayload: object) {
  const eventName = payload.event?.name ?? payload.data?.type ?? 'unknown';
  const documentKey = payload.event?.data?.document?.key ?? payload.document?.key ?? null;
  const envelopeKey = payload.data?.id ?? payload.event?.data?.envelope?.key ?? null;

  const eventId = `clicksign-${envelopeKey ?? documentKey ?? 'noid'}-${eventName}-${Date.now()}`;

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
    const result = await handleClicksignEvent(payload, documentKey, envelopeKey);
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
  envelopeKey: string | null,
) {
  const eventName = payload.event?.name ?? '';
  const envelopeStatus = payload.data?.attributes?.status as string | undefined;

  console.log(`[CLICKSIGN WEBHOOK] evento="${eventName}" envelopeKey="${envelopeKey}" docKey="${documentKey}" status="${envelopeStatus ?? ''}"`);

  // Busca o ClicksignDocument — tenta por envelope ID (v3) ou document key (v1)
  let doc = envelopeKey
    ? await prisma.clicksignDocument.findFirst({ where: { externalEnvelopeId: envelopeKey } })
    : null;
  if (!doc && documentKey) {
    doc = await prisma.clicksignDocument.findUnique({ where: { externalDocumentId: documentKey } });
  }
  if (!doc) {
    logger.warn(`Clicksign webhook: doc não encontrado (envelope: ${envelopeKey}, doc: ${documentKey})`);
    return { skipped: true, reason: 'documento não encontrado no sistema' };
  }

  // ── Assinatura individual (sign) — atualiza o signatário no rawPayload ──────
  if (INDIVIDUAL_SIGN_EVENTS.includes(eventName)) {
    const signerEmail = payload.event?.data?.signer?.email ?? null;
    console.log(`[CLICKSIGN WEBHOOK] Assinatura individual: "${signerEmail}"`);

    if (signerEmail) {
      const rawPayload = (doc.rawPayload as any) ?? {};
      const signers: any[] = rawPayload.signers ?? [];
      const updated = signers.map((s: any) =>
        s.email === signerEmail
          ? { ...s, status: 'signed', signed_at: new Date().toISOString() }
          : s,
      );
      await prisma.clicksignDocument.update({
        where: { id: doc.id },
        data: { rawPayload: { ...rawPayload, signers: updated } as any },
      });
    }
    return { processed: true, event: 'individual_sign', signer: signerEmail };
  }

  // ── Conclusão total (auto_close / document_closed) ────────────────────────
  const isEnvelopeClosed =
    COMPLETED_EVENTS.includes(eventName) ||
    (payload.data?.type === 'envelopes' && ENVELOPE_CLOSED_STATUSES.includes(envelopeStatus ?? ''));

  if (!isEnvelopeClosed) {
    return { skipped: true, reason: `evento "${eventName}" não requer ação` };
  }

  if (doc.signedAt) {
    return { skipped: true, reason: 'já processado' };
  }

  await prisma.clicksignDocument.update({
    where: { id: doc.id },
    data: { status: 'closed', signedAt: new Date() },
  });

  await markSigningComplete(doc.contractTrackingId, doc.externalDocumentId ?? doc.externalEnvelopeId ?? '');

  console.log(`[CLICKSIGN WEBHOOK] Todos assinaram — tracking ${doc.contractTrackingId} avançado para Cadastro`);
  logger.info(`Clicksign: todos assinaram — tracking ${doc.contractTrackingId}`);
  return { processed: true, event: 'all_signed', trackingId: doc.contractTrackingId };
}

export function verifyClicksignToken(token: string | undefined): boolean {
  if (!env.CLICKSIGN_WEBHOOK_TOKEN) return true;
  return token === env.CLICKSIGN_WEBHOOK_TOKEN;
}
