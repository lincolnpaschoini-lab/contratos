import { prisma } from '../../../config/database';
import { createContractFromDeal } from '../../contracts/contracts.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import {
  fetchOrganization,
  fetchPerson,
  fetchOrganizationFields,
  fetchDealFields,
  fetchPipedriveUser,
  resolveDealEnumValue,
  extractPrimaryEmail,
  extractPrimaryPhone,
  extractAddress,
  buildLabeledFields,
  detectDocument,
  type PipedriveApiContext,
} from './pipedrive.api';

// API key do campo customizado "tipo_servico" no Pipedrive
const TIPO_SERVICO_FIELD = 'b9e2317c3051565d2ad79d04ce9d8b9143ac1fc8';

// ─── Configuração multi-empresa ───────────────────────────────────────────────

interface CompanyConfig extends PipedriveApiContext {
  proposalStageId: string;
  preparationStageId: string;
  signingStageId: string;
}

/** Resolve o config da empresa pelo company_id que vem no meta do webhook. */
function resolveCompanyConfig(companyId: string): CompanyConfig {
  const companies: (CompanyConfig & { companyId: string })[] = [
    {
      companyId: env.PIPEDRIVE_PASCHOINI_COMPANY_ID ?? '',
      companyName: 'Paschoini',
      apiToken: env.PIPEDRIVE_API_TOKEN ?? '',
      domain: env.PIPEDRIVE_DOMAIN ?? '',
      proposalStageId: env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID,
      preparationStageId: env.PIPEDRIVE_CONTRACT_PREPARATION_STAGE_ID,
      signingStageId: env.PIPEDRIVE_CONTRACT_SIGNING_STAGE_ID,
    },
    {
      companyId: env.PIPEDRIVE_ATTIVOS_COMPANY_ID ?? '',
      companyName: 'Attivos',
      apiToken: env.PIPEDRIVE_ATTIVOS_API_TOKEN ?? '',
      domain: env.PIPEDRIVE_ATTIVOS_DOMAIN ?? '',
      proposalStageId: env.PIPEDRIVE_ATTIVOS_PROPOSAL_STAGE_ID,
      preparationStageId: env.PIPEDRIVE_ATTIVOS_PREPARATION_STAGE_ID,
      signingStageId: env.PIPEDRIVE_ATTIVOS_SIGNING_STAGE_ID,
    },
    {
      companyId: env.PIPEDRIVE_FOCUS_COMPANY_ID ?? '',
      companyName: 'Focus',
      apiToken: env.PIPEDRIVE_FOCUS_API_TOKEN ?? '',
      domain: env.PIPEDRIVE_FOCUS_DOMAIN ?? '',
      proposalStageId: env.PIPEDRIVE_FOCUS_PROPOSAL_STAGE_ID,
      preparationStageId: env.PIPEDRIVE_FOCUS_PREPARATION_STAGE_ID,
      signingStageId: env.PIPEDRIVE_FOCUS_SIGNING_STAGE_ID,
    },
  ];

  const match = companies.find((c) => c.companyId && c.companyId === String(companyId));
  if (match) {
    logger.info(`Pipedrive webhook: empresa identificada — ${match.companyName} (company_id: ${companyId})`);
    return match;
  }

  // Fallback seguro: só usa config legado se nenhuma empresa extra está configurada
  // (sistema ainda de tenant único). Se houver pelo menos uma empresa configurada,
  // rejeita company_ids desconhecidos para não misturar dados entre empresas.
  const hasMultiTenant = companies.slice(1).some((c) => c.companyId && c.apiToken);
  if (hasMultiTenant) {
    logger.error(`Pipedrive webhook: company_id "${companyId}" não está mapeado em nenhuma empresa configurada — webhook IGNORADO para evitar dados incorretos. Configure PIPEDRIVE_ATTIVOS_COMPANY_ID ou PIPEDRIVE_FOCUS_COMPANY_ID.`);
    return null as any; // sinaliza para o chamador ignorar
  }

  logger.warn(`Pipedrive webhook: company_id "${companyId}" não mapeado — usando config padrão (Paschoini)`);
  return {
    companyName: 'Paschoini',
    apiToken: env.PIPEDRIVE_API_TOKEN ?? '',
    domain: env.PIPEDRIVE_DOMAIN ?? '',
    proposalStageId: env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID,
    preparationStageId: env.PIPEDRIVE_CONTRACT_PREPARATION_STAGE_ID,
    signingStageId: env.PIPEDRIVE_CONTRACT_SIGNING_STAGE_ID,
  };
}

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
    company_id?: string | number;
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
  owner_id?: number | string;
  pipeline_id?: number;
  status?: string;
  custom_fields?: Record<string, unknown>;
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

  // Identifica a empresa pelo company_id do metadata do webhook
  const companyId = String(payload.meta?.company_id ?? '');
  const config    = resolveCompanyConfig(companyId);

  if (!config || !config.apiToken) {
    const reason = `company_id "${companyId}" não mapeado — configure PIPEDRIVE_PASCHOINI_COMPANY_ID (ou _ATTIVOS_ / _FOCUS_)`;
    logger.error(`Pipedrive webhook ignorado: empresa não identificada para company_id "${companyId}".`);
    if (existingEventId) {
      await prisma.webhookEvent.update({
        where: { id: existingEventId },
        data: { processed: true, processedAt: new Date(), errorMessage: reason },
      }).catch(() => {});
    }
    return { skipped: true, reason };
  }

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
    const result = await handleDealUpdate(payload, config);

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

async function handleDealUpdate(payload: PipedriveWebhookPayload, config: CompanyConfig) {
  const { dealData, dealId } = normalizePipedrivePayload(payload);

  if (!dealId) {
    return { skipped: true, reason: 'sem deal ID no payload' };
  }

  const currentStageId  = String(dealData.stage_id ?? '');
  const previousStageId = String(payload.previous?.stage_id ?? '');
  const pipedriveUserId = dealData.owner_id ?? payload.meta?.user_id;

  // Usa os stage IDs da empresa identificada pelo company_id
  const { proposalStageId, preparationStageId: prepStageId, signingStageId } = config;

  logger.info(`[${config.companyName}] Pipedrive deal ${dealId}: stage ${previousStageId} → ${currentStageId}`);

  if (signingStageId && currentStageId === signingStageId && previousStageId !== signingStageId) {
    return handleMoveToSigning(dealId, dealData, pipedriveUserId, config);
  }

  if (prepStageId && currentStageId === prepStageId && previousStageId !== prepStageId) {
    return handleMoveToPreparation(dealId, dealData, pipedriveUserId, config);
  }

  const isProposalAccepted = proposalStageId
    ? currentStageId === proposalStageId && previousStageId !== proposalStageId
    : (dealData.stage_name?.toLowerCase().includes('proposta aceita') ?? false);

  if (!isProposalAccepted) {
    return { skipped: true, reason: `estágio ${currentStageId} não mapeado` };
  }

  const existingDeal = await prisma.pipedriveDeal.findUnique({ where: { externalDealId: dealId } });
  if (existingDeal) {
    logger.info(`Deal Pipedrive ${dealId} já possui tracking — ignorado.`);
    return { skipped: true, reason: 'deal já processado anteriormente' };
  }

  // Busca dados enriquecidos usando o token da empresa correta
  const [org, person, orgFields, ownerUser, dealFields] = await Promise.all([
    dealData.org_id ? fetchOrganization(dealData.org_id, config) : Promise.resolve(null),
    dealData.person_id ? fetchPerson(dealData.person_id, config) : Promise.resolve(null),
    fetchOrganizationFields(config),
    dealData.owner_id ? fetchPipedriveUser(dealData.owner_id, config) : Promise.resolve(null),
    fetchDealFields(config),
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
    pipedriveOwnerName: ownerUser?.name ?? undefined,
    tipoServico: resolveDealEnumValue(dealData.custom_fields?.[TIPO_SERVICO_FIELD], dealFields, TIPO_SERVICO_FIELD) ?? undefined,
    pipedriveCompanyId: String(payload.meta?.company_id ?? '') || undefined,
  });

  logger.info(`Contrato criado para deal Pipedrive ${dealId}: "${dealData.title}" — org: ${org?.name ?? 'sem org'}, pessoa: ${person?.name ?? 'sem pessoa'}`);
  return { created: true, externalDealId: dealId };
}

async function handleMoveToPreparation(dealId: string, dealData: DealData, pipedriveUserId?: string | number, config?: CompanyConfig) {
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
  const { startStep, completeStep } = await import('../../contracts/contracts.service');

  const pipedriveUser = pipedriveUserId ? await fetchPipedriveUser(pipedriveUserId, config) : null;
  const stepMetadata = { source: 'pipedrive', ...(pipedriveUser && { pipedriveUser: { id: pipedriveUserId, name: pipedriveUser.name } }) };

  // PROPOSAL_ACCEPTED agora nasce IN_PROGRESS — precisa concluí-la antes de avançar.
  // completeStep auto-inicia CONTRACT_PREPARATION como próxima etapa.
  const proposalStep = tracking.steps.find((s) => s.stepName === 'PROPOSAL_ACCEPTED');
  if (proposalStep && (proposalStep.status === StepStatus.IN_PROGRESS || proposalStep.status === StepStatus.DELAYED)) {
    await completeStep(tracking.id, proposalStep.id, 'system-pipedrive', 'Proposta concluída ao avançar para Preparação via Pipedrive', stepMetadata);
    logger.info(`Deal ${dealId}: Proposta concluída e Preparação iniciada via Pipedrive`);
    return { advanced: true, trackingId: tracking.id, step: 'CONTRACT_PREPARATION' };
  }

  // Fallback: proposta já estava concluída anteriormente
  const prepStep = tracking.steps.find((s) => s.stepName === 'CONTRACT_PREPARATION');
  if (!prepStep) {
    return { skipped: true, reason: 'etapa de preparação não encontrada' };
  }

  if (prepStep.status !== StepStatus.PENDING) {
    logger.info(`Deal ${dealId}: Preparação já foi iniciada (status: ${prepStep.status})`);
    return { skipped: true, reason: `preparação já em status ${prepStep.status}` };
  }

  await startStep(tracking.id, prepStep.id, 'system-pipedrive', stepMetadata);
  logger.info(`Deal ${dealId}: Preparação do Contrato iniciada via Pipedrive por ${pipedriveUser?.name ?? pipedriveUserId ?? 'desconhecido'}`);
  return { advanced: true, trackingId: tracking.id, step: 'CONTRACT_PREPARATION' };
}

async function handleMoveToSigning(dealId: string, dealData: DealData, pipedriveUserId?: string | number, config?: CompanyConfig) {
  const existingDeal = await prisma.pipedriveDeal.findUnique({
    where: { externalDealId: dealId },
    include: { contractTracking: { include: { steps: true, customer: true } } },
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
    console.log(`[PIPEDRIVE] Deal ${dealId}: Assinatura já em status "${signingStep.status}" — Clicksign NÃO será enviado automaticamente`);
    logger.info(`Deal ${dealId}: Assinatura já iniciada (status: ${signingStep.status})`);
    return { skipped: true, reason: `assinatura já em status ${signingStep.status}` };
  }

  const pipedriveUser = pipedriveUserId ? await fetchPipedriveUser(pipedriveUserId, config) : null;
  const stepMetadata = { source: 'pipedrive', ...(pipedriveUser && { pipedriveUser: { id: pipedriveUserId, name: pipedriveUser.name } }) };

  // Cascata de conclusões: Proposta → Preparação → Assinatura.
  // PROPOSAL_ACCEPTED agora nasce IN_PROGRESS, então precisa ser concluída primeiro.
  const proposalStep = tracking.steps.find((s) => s.stepName === 'PROPOSAL_ACCEPTED');
  if (proposalStep && (proposalStep.status === StepStatus.IN_PROGRESS || proposalStep.status === StepStatus.DELAYED)) {
    await completeStep(tracking.id, proposalStep.id, 'system-pipedrive', 'Proposta concluída ao avançar para Assinatura via Pipedrive', stepMetadata);
    // completeStep auto-inicia CONTRACT_PREPARATION
  }

  // Garante que Preparação está concluída antes de iniciar Assinatura.
  // Re-busca status atualizado pois pode ter sido auto-iniciada acima.
  const freshPrep = await prisma.contractStep.findFirst({
    where: { contractTrackingId: tracking.id, stepName: 'CONTRACT_PREPARATION' },
  });
  if (freshPrep) {
    if (freshPrep.status === StepStatus.PENDING) {
      await startStep(tracking.id, freshPrep.id, 'system-pipedrive', stepMetadata);
      await completeStep(tracking.id, freshPrep.id, 'system-pipedrive', 'Preparação concluída via mudança de estágio no Pipedrive', stepMetadata);
    } else if (freshPrep.status === StepStatus.IN_PROGRESS || freshPrep.status === StepStatus.DELAYED) {
      await completeStep(tracking.id, freshPrep.id, 'system-pipedrive', 'Preparação concluída via mudança de estágio no Pipedrive', stepMetadata);
    }
    // Se COMPLETED: CONTRACT_SIGNING continua PENDING e cai no startStep abaixo
  }

  // Se completeStep já auto-iniciou a Assinatura, não chama startStep novamente
  const freshSigning = await prisma.contractStep.findUnique({ where: { id: signingStep.id } });
  if (freshSigning && freshSigning.status === StepStatus.PENDING) {
    await startStep(tracking.id, signingStep.id, 'system-pipedrive', stepMetadata);
  }

  logger.info(`Deal ${dealId}: Assinatura do Contrato iniciada via Pipedrive (estágio ${dealData.stage_id}) por ${pipedriveUser?.name ?? pipedriveUserId ?? 'desconhecido'}`);

  // Resolve o enum do Pipedrive (vem como { id, type } no v2) para o label legível
  const dealFieldsForSigning = await fetchDealFields(config);
  const tipoServico = resolveDealEnumValue(dealData.custom_fields?.[TIPO_SERVICO_FIELD], dealFieldsForSigning, TIPO_SERVICO_FIELD);
  if (tipoServico && !(existingDeal as any).tipoServico) {
    await prisma.pipedriveDeal.update({
      where: { id: existingDeal.id },
      data: { tipoServico } as any,
    });
  }

  // Envia contrato para assinatura no Clicksign
  const customer = (existingDeal.contractTracking as any).customer;
  const customerEmail = customer?.contactEmail ?? customer?.email ?? null;
  const customerName = customer?.name ?? 'Cliente';

  console.log(`[PIPEDRIVE] Deal ${dealId}: preparando envio Clicksign — tipoServico: "${tipoServico}", email: "${customerEmail}"`);

  if (customerEmail) {
    const { sendContractToClicksign } = await import('../clicksign/clicksign.service');
    sendContractToClicksign({ trackingId: tracking.id, tipoServico, customerName, customerEmail })
      .then((r) => {
        console.log(`[PIPEDRIVE] Clicksign: ${r.sent ? `envelope ${r.envelopeId} enviado` : `ignorado — ${r.reason}`}`);
        logger.info(`Clicksign: ${r.sent ? `envelope ${r.envelopeId} enviado` : `ignorado — ${r.reason}`}`);
      })
      .catch((err) => {
        console.error(`[PIPEDRIVE] Clicksign ERRO: ${err.message}`);
        logger.error(`Clicksign: falha ao enviar contrato do deal ${dealId} — ${err.message}`);
      });
  } else {
    console.log(`[PIPEDRIVE] Deal ${dealId}: sem email do cliente — Clicksign não enviado`);
    logger.warn(`Clicksign: deal ${dealId} sem email do cliente — Clicksign não enviado`);
  }

  return { advanced: true, trackingId: tracking.id, step: 'CONTRACT_SIGNING' };
}

// ─── Helper público: nome da empresa pelo company_id do Pipedrive ────────────

const COMPANY_CSS: Record<string, string> = {
  Paschoini: 'primary',
  Attivos:   'success',
  Focus:     'warning',
};

export function getCompanyInfo(companyId: string | number | null | undefined): { name: string; css: string } {
  const id = companyId ? String(companyId) : '';

  if (id && env.PIPEDRIVE_PASCHOINI_COMPANY_ID && id === env.PIPEDRIVE_PASCHOINI_COMPANY_ID) {
    return { name: 'Paschoini', css: 'primary' };
  }
  if (id && env.PIPEDRIVE_ATTIVOS_COMPANY_ID && id === env.PIPEDRIVE_ATTIVOS_COMPANY_ID) {
    return { name: 'Attivos', css: 'success' };
  }
  if (id && env.PIPEDRIVE_FOCUS_COMPANY_ID && id === env.PIPEDRIVE_FOCUS_COMPANY_ID) {
    return { name: 'Focus', css: 'warning' };
  }
  // Sem company_id mapeado mas com config legado → assume Paschoini
  if (!id || (!env.PIPEDRIVE_PASCHOINI_COMPANY_ID && (env.PIPEDRIVE_API_TOKEN || env.PIPEDRIVE_DOMAIN))) {
    return { name: 'Paschoini', css: 'primary' };
  }
  return { name: `ID: ${id}`, css: 'secondary' };
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
