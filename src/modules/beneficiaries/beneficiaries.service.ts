import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { createNotification } from '../notifications/notifications.service';

export interface BeneficiaryPFInput {
  nome: string;
  cpf: string;
  pipedrivePersonId?: string;
}

export interface BeneficiaryPJInput {
  razaoSocial: string;
  cnpj: string;
  endereco?: string;
  pipedriveOrgId?: string;
}

export interface SubmitBeneficiariesPayload {
  none: boolean;
  pf: BeneficiaryPFInput[];
  pj: BeneficiaryPJInput[];
}

export interface ActionResult {
  success: boolean;
  title: string;
  message: string;
  customerName?: string;
}

/** Dispara o e-mail pedindo a definição dos beneficiários — chamado ao entrar em Assinatura com um tipo de serviço "*-BENEFICIARIOS". */
export async function requestBeneficiaries(trackingId: string): Promise<void> {
  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: { customer: true, pipedriveDeal: true },
  });
  if (!tracking) throw new Error(`Contrato ${trackingId} não encontrado`);

  const companyId = (tracking.pipedriveDeal as any)?.companyId ?? null;
  const specificRule = companyId
    ? await prisma.beneficiaryNotifyRule.findFirst({ where: { companyId } })
    : null;
  const globalRule = await prisma.beneficiaryNotifyRule.findFirst({ where: { companyId: null } });
  const rule = specificRule ?? globalRule;

  const recipients = rule?.active && rule.notifyEmails
    ? rule.notifyEmails.split(',').map((e) => e.trim()).filter(Boolean)
    : [];

  if (recipients.length === 0) {
    logger.error(`Beneficiários: nenhum destinatário configurado para o contrato ${trackingId} — configure em Config. de SLA → Beneficiários`);
    await createNotification({
      type: 'beneficiaries_pending',
      title: `Configuração pendente: notificação de beneficiários — ${tracking.customer.name}`,
      body: 'Nenhum e-mail configurado para receber o pedido de definição de beneficiários. Configure em Config. de SLA → Beneficiários e reenvie.',
      trackingId,
    });
    return;
  }

  const { sendBeneficiariesRequestEmail } = await import('../email/email.service');
  await sendBeneficiariesRequestEmail(trackingId, recipients);

  await prisma.contractTracking.update({
    where: { id: trackingId },
    data: { beneficiariesRequestedAt: new Date() },
  });
}

async function loadValidToken(token: string) {
  const actionToken = await prisma.actionToken.findUnique({
    where: { token },
    include: { contractTracking: { include: { customer: true, pipedriveDeal: true } } },
  });

  if (!actionToken || actionToken.action !== 'fill_beneficiaries') {
    const error: ActionResult = { success: false, title: 'Link inválido', message: 'Este link é inválido ou não existe.' };
    return { ok: false as const, error };
  }

  if (actionToken.usedAt) {
    const error: ActionResult = {
      success: true,
      title: 'Já confirmado',
      message: `A definição de beneficiários do contrato de ${actionToken.contractTracking.customer.name} já foi confirmada anteriormente.`,
      customerName: actionToken.contractTracking.customer.name,
    };
    return { ok: false as const, error };
  }

  if (new Date() > actionToken.expiresAt) {
    const error: ActionResult = { success: false, title: 'Link expirado', message: 'Este link expirou. Entre em contato com a equipe interna para reenvio.' };
    return { ok: false as const, error };
  }

  return { ok: true as const, actionToken };
}

export async function getBeneficiaryFormData(token: string) {
  const result = await loadValidToken(token);
  if (!result.ok) return { error: result.error };
  return { actionToken: result.actionToken };
}

export async function searchPipedrive(token: string, type: 'pf' | 'pj', term: string) {
  const result = await loadValidToken(token);
  if (!result.ok) throw new Error('token inválido');

  const { getPipedriveApiContextForCompany } = await import('../integrations/pipedrive/pipedrive.service');
  const { searchPersons, searchOrganizations } = await import('../integrations/pipedrive/pipedrive.api');

  const companyId = (result.actionToken.contractTracking.pipedriveDeal as any)?.companyId ?? null;
  const ctx = getPipedriveApiContextForCompany(companyId);

  return type === 'pf' ? searchPersons(term, ctx) : searchOrganizations(term, ctx);
}

export async function selectPipedriveRecord(token: string, type: 'pf' | 'pj', id: string) {
  const result = await loadValidToken(token);
  if (!result.ok) throw new Error('token inválido');

  const { getPipedriveApiContextForCompany, extractPersonFields, extractOrgFields } = await import('../integrations/pipedrive/pipedrive.service');
  const { fetchPerson, fetchOrganization } = await import('../integrations/pipedrive/pipedrive.api');

  const companyId = (result.actionToken.contractTracking.pipedriveDeal as any)?.companyId ?? null;
  const ctx = getPipedriveApiContextForCompany(companyId);

  if (type === 'pf') {
    const person = await fetchPerson(id, ctx);
    const extracted = extractPersonFields(person as any);
    return { nome: extracted?.nome ?? person?.name ?? '', cpf: extracted?.cpf ?? '' };
  }

  const org = await fetchOrganization(id, ctx);
  const extracted = extractOrgFields(org as any);
  return { razaoSocial: extracted?.razaoSocial ?? org?.name ?? '', cnpj: extracted?.cnpj ?? '', endereco: extracted?.endereco ?? '' };
}

export async function submitBeneficiaries(token: string, payload: SubmitBeneficiariesPayload): Promise<ActionResult> {
  const result = await loadValidToken(token);
  if (!result.ok) return result.error;

  const { actionToken } = result;
  const tracking = actionToken.contractTracking;

  if (!payload.none) {
    await prisma.contractBeneficiary.deleteMany({ where: { contractTrackingId: tracking.id } });

    const rows = [
      ...payload.pf.filter((p) => p.nome?.trim() || p.cpf?.trim()).map((p) => ({
        contractTrackingId: tracking.id,
        type: 'PF',
        nome: p.nome?.trim() || null,
        cpf: p.cpf?.trim() || null,
        pipedrivePersonId: p.pipedrivePersonId || null,
      })),
      ...payload.pj.filter((p) => p.razaoSocial?.trim() || p.cnpj?.trim()).map((p) => ({
        contractTrackingId: tracking.id,
        type: 'PJ',
        razaoSocial: p.razaoSocial?.trim() || null,
        cnpj: p.cnpj?.trim() || null,
        endereco: p.endereco?.trim() || null,
        pipedriveOrgId: p.pipedriveOrgId || null,
      })),
    ];

    if (rows.length > 0) {
      await prisma.contractBeneficiary.createMany({ data: rows as any });
    }
  }

  await prisma.contractTracking.update({
    where: { id: tracking.id },
    data: { beneficiariesDefinedAt: new Date() },
  });

  await prisma.actionToken.update({ where: { id: actionToken.id }, data: { usedAt: new Date() } });

  logger.info(`[BENEFICIÁRIOS] Definição confirmada — tracking ${tracking.id} (none: ${payload.none})`);

  const customer = tracking.customer as any;
  const customerEmail = customer?.contactEmail ?? customer?.email ?? null;
  const tipoServico = (tracking.pipedriveDeal as any)?.tipoServico ?? null;

  if (customerEmail) {
    try {
      const { sendContractToClicksign } = await import('../integrations/clicksign/clicksign.service');
      const sendResult = await sendContractToClicksign({
        trackingId: tracking.id,
        tipoServico,
        customerName: customer?.name ?? 'Cliente',
        customerEmail,
      });
      if (!sendResult.sent) {
        logger.warn(`[BENEFICIÁRIOS] Contrato ${tracking.id} não foi enviado ao Clicksign automaticamente: ${sendResult.reason}`);
      }
    } catch (err: any) {
      logger.error(`[BENEFICIÁRIOS] Falha ao enviar ao Clicksign após definição de beneficiários — tracking ${tracking.id}: ${err.message}`);
    }
  } else {
    logger.warn(`[BENEFICIÁRIOS] Contrato ${tracking.id} sem e-mail de cliente — envio ao Clicksign não disparado automaticamente`);
  }

  return {
    success: true,
    title: 'Beneficiários confirmados!',
    message: `A definição de beneficiários do contrato de ${tracking.customer.name} foi registrada com sucesso. O contrato de assinatura está sendo preparado.`,
    customerName: tracking.customer.name,
  };
}
