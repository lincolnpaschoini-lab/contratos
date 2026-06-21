import { StepStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { formatDate, formatDateTime, formatCurrency, STEP_LABELS, STEP_STATUS_LABELS } from '../../shared/utils/format';
import { sendMail } from './graph-mailer';

const ACTION_EXPIRY_DAYS = 30;

/** Dispara notificação de cadastro pendente. Lança erro se credenciais não estiverem configuradas. */
export async function sendRegistrationActionEmail(trackingId: string): Promise<void> {
  logger.info(`[EMAIL] sendRegistrationActionEmail chamado — tracking: ${trackingId}`);
  logger.info(`[EMAIL] GRAPH_TENANT_ID: ${env.GRAPH_TENANT_ID ? 'configurado' : 'AUSENTE'}`);
  logger.info(`[EMAIL] GRAPH_CLIENT_ID: ${env.GRAPH_CLIENT_ID ? 'configurado' : 'AUSENTE'}`);
  logger.info(`[EMAIL] GRAPH_CLIENT_SECRET: ${env.GRAPH_CLIENT_SECRET ? 'configurado' : 'AUSENTE'}`);
  logger.info(`[EMAIL] GRAPH_SENDER_EMAIL: ${env.GRAPH_SENDER_EMAIL}`);
  logger.info(`[EMAIL] REGISTRATION_NOTIFY_EMAIL: ${env.REGISTRATION_NOTIFY_EMAIL ?? 'AUSENTE'}`);

  if (!env.GRAPH_TENANT_ID || !env.GRAPH_CLIENT_ID || !env.GRAPH_CLIENT_SECRET) {
    throw new Error('Credenciais Microsoft Graph não configuradas (GRAPH_TENANT_ID, GRAPH_CLIENT_ID ou GRAPH_CLIENT_SECRET ausentes)');
  }

  if (!env.REGISTRATION_NOTIFY_EMAIL) {
    throw new Error('REGISTRATION_NOTIFY_EMAIL não configurado');
  }

  const existing = await prisma.actionToken.findFirst({
    where: { trackingId, action: 'complete_registration', usedAt: null, expiresAt: { gt: new Date() } },
  });

  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: {
      customer: true,
      pipedriveDeal: true,
      assignedUser: { select: { name: true, email: true } },
      steps: {
        orderBy: { stepOrder: 'asc' },
        include: { assignedUser: { select: { name: true } } },
      },
      clicksignDocs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!tracking) throw new Error(`Contrato ${trackingId} não encontrado`);

  let token: string;
  if (existing) {
    logger.info(`[EMAIL] Reutilizando token existente para ${trackingId}`);
    token = existing.token;
  } else {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ACTION_EXPIRY_DAYS);
    const created = await prisma.actionToken.create({
      data: { trackingId, action: 'complete_registration', expiresAt, metadata: { customerName: tracking.customer.name } },
      select: { token: true },
    });
    token = created.token;
  }

  const actionUrl = `${env.APP_URL}/acoes/cadastro/${token}`;
  logger.info(`[EMAIL] URL de ação gerada: ${actionUrl}`);

  await sendMail({
    to: env.REGISTRATION_NOTIFY_EMAIL,
    subject: `Cadastro de contrato pendente — ${tracking.customer.name}`,
    html: buildEmailHtml(tracking, actionUrl),
  });

  logger.info(`[EMAIL] Notificação enviada para ${env.REGISTRATION_NOTIFY_EMAIL} — tracking ${trackingId}`);
}

// ─── Notificação de atraso ────────────────────────────────────────────────────

/** Dispara alerta de atraso. Usa os e-mails configurados na regra de SLA da etapa; cai no DELAY_NOTIFY_EMAILS como fallback. */
export async function sendDelayNotificationEmail(trackingId: string, stepId: string): Promise<void> {
  if (!env.GRAPH_TENANT_ID || !env.GRAPH_CLIENT_ID || !env.GRAPH_CLIENT_SECRET) {
    logger.warn('[EMAIL] Alerta de atraso ignorado — credenciais Graph não configuradas');
    return;
  }

  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: {
      customer: true,
      pipedriveDeal: true,
      assignedUser: { select: { name: true, email: true } },
      steps: {
        orderBy: { stepOrder: 'asc' },
        include: { assignedUser: { select: { name: true } } },
      },
    },
  });

  if (!tracking) {
    logger.warn(`[EMAIL] Alerta de atraso: tracking ${trackingId} não encontrado`);
    return;
  }

  const delayedStep = tracking.steps.find((s) => s.id === stepId);
  if (!delayedStep) {
    logger.warn(`[EMAIL] Alerta de atraso: step ${stepId} não encontrado`);
    return;
  }

  // Busca e-mails: regra específica da empresa → regra global → env var
  const companyId = (tracking as any).pipedriveDeal?.companyId ?? null;
  const specificRule = companyId
    ? await prisma.slaRule.findFirst({ where: { stepName: delayedStep.stepName, companyId } })
    : null;
  const globalRule = await prisma.slaRule.findFirst({ where: { stepName: delayedStep.stepName, companyId: null } });
  const slaRule = specificRule ?? globalRule;
  const ruleEmails = slaRule?.notifyEmails
    ? slaRule.notifyEmails.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
  const fallbackEmails = (env.DELAY_NOTIFY_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  const recipients = ruleEmails.length > 0 ? ruleEmails : fallbackEmails;

  if (recipients.length === 0) {
    logger.warn(`[EMAIL] Alerta de atraso ignorado — sem destinatários configurados para ${delayedStep.stepName}`);
    return;
  }

  const stepLabel = STEP_LABELS[delayedStep.stepName as keyof typeof STEP_LABELS] ?? delayedStep.stepName;
  const daysLate  = delayedStep.dueAt
    ? Math.floor((Date.now() - new Date(delayedStep.dueAt).getTime()) / 86_400_000)
    : null;

  const contractUrl = `${env.APP_URL}/contracts/${trackingId}`;

  await sendMail({
    to: recipients,
    subject: `⚠ Atraso: ${stepLabel} — ${tracking.customer.name}`,
    html: buildDelayEmailHtml(tracking, delayedStep, stepLabel, daysLate, contractUrl),
  });

  logger.info(`[EMAIL] Alerta de atraso enviado para ${recipients.join(', ')} — step ${stepLabel} (${trackingId})`);
}

// ─── Notificação de novo lead em etapa ───────────────────────────────────────

/** Dispara alerta de novo registro na etapa para os e-mails configurados na regra de SLA. */
export function sendNewLeadNotificationEmail(trackingId: string, stepName: string): void {
  if (!env.GRAPH_TENANT_ID || !env.GRAPH_CLIENT_ID || !env.GRAPH_CLIENT_SECRET) {
    logger.warn('[EMAIL] Notificação de novo lead ignorada — credenciais Graph não configuradas');
    return;
  }

  // Para CONTRACT_SIGNING aguarda 1 min para garantir que o envelope Clicksign
  // (e seus signatários) já esteja criado quando o email for montado.
  const delayMs = stepName === 'CONTRACT_SIGNING' ? 60_000 : 0;

  setTimeout(() => {
    _sendNewLeadCore(trackingId, stepName).catch((err) =>
      logger.error(`[EMAIL] Erro na notificação de novo lead (${stepName}): ${err.message}`),
    );
  }, delayMs);
}

async function _sendNewLeadCore(trackingId: string, stepName: string): Promise<void> {
  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: {
      customer: true,
      pipedriveDeal: true,
      assignedUser: { select: { name: true, email: true } },
      steps: {
        orderBy: { stepOrder: 'asc' },
        include: { assignedUser: { select: { name: true } } },
      },
      clicksignDocs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!tracking) {
    logger.warn(`[EMAIL] Novo lead: tracking ${trackingId} não encontrado`);
    return;
  }

  // Fallback empresa → global
  const companyId = tracking.pipedriveDeal?.companyId ?? null;
  const specificRule = companyId
    ? await prisma.slaRule.findFirst({ where: { stepName: stepName as any, companyId } })
    : null;
  const globalRule = await prisma.slaRule.findFirst({ where: { stepName: stepName as any, companyId: null } });
  const slaRule = specificRule ?? globalRule;

  if (!slaRule?.notifyOnNewLead) return;

  const recipients = slaRule.notifyEmails
    ? slaRule.notifyEmails.split(',').map((e) => e.trim()).filter(Boolean)
    : [];

  if (recipients.length === 0) {
    logger.warn(`[EMAIL] Notificação de novo lead ignorada — sem e-mails configurados para ${stepName}`);
    return;
  }

  const stepLabel = STEP_LABELS[stepName as keyof typeof STEP_LABELS] ?? stepName;
  const contractUrl = `${env.APP_URL}/contracts/${trackingId}`;

  await sendMail({
    to: recipients,
    subject: `🔔 Novo registro: ${stepLabel} — ${tracking.customer.name}`,
    html: buildNewLeadEmailHtml(tracking, stepLabel, contractUrl, stepName),
  });

  logger.info(`[EMAIL] Notificação de novo lead enviada para ${recipients.join(', ')} — step ${stepLabel} (${trackingId})`);
}

// ─── Templates ────────────────────────────────────────────────────────────────

type Tracking = Awaited<ReturnType<typeof prisma.contractTracking.findUnique>> & {
  customer: NonNullable<unknown>;
  pipedriveDeal: NonNullable<unknown>;
  steps: NonNullable<unknown>[];
};

function row(label: string, value: string | null | undefined): string {
  if (!value) return '';
  return `
  <tr>
    <td style="padding:6px 0;color:#64748b;font-size:13px;width:40%;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;color:#1a1f2e;font-size:13px;font-weight:600;vertical-align:top;">${value}</td>
  </tr>`;
}

function sectionTitle(title: string): string {
  return `<p style="margin:28px 0 12px;color:#1a1f2e;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">${title}</p>`;
}

const STEP_STATUS_COLOR: Record<string, string> = {
  COMPLETED:   '#16a34a',
  IN_PROGRESS: '#d97706',
  DELAYED:     '#dc2626',
  PENDING:     '#94a3b8',
};

const STEP_STATUS_BG: Record<string, string> = {
  COMPLETED:   '#dcfce7',
  IN_PROGRESS: '#fef3c7',
  DELAYED:     '#fee2e2',
  PENDING:     '#f1f5f9',
};

const STEP_STATUS_ICON: Record<string, string> = {
  COMPLETED:   '✓',
  IN_PROGRESS: '⏳',
  DELAYED:     '⚠',
  PENDING:     '○',
};

function buildDelayEmailHtml(
  tracking: any,
  delayedStep: any,
  stepLabel: string,
  daysLate: number | null,
  contractUrl: string,
): string {
  const c = tracking.customer;
  const d = tracking.pipedriveDeal;

  const addressParts = [c.address, c.city, c.state && c.city ? `/${c.state}` : c.state, c.zipCode ? `CEP ${c.zipCode}` : null].filter(Boolean);
  const address = addressParts.join(' ') || null;

  const stepsHtml = tracking.steps.map((step: any) => {
    const isDelayed = step.id === delayedStep.id;
    const color  = STEP_STATUS_COLOR[step.status] ?? '#94a3b8';
    const bg     = STEP_STATUS_BG[step.status]    ?? '#f1f5f9';
    const icon   = STEP_STATUS_ICON[step.status]  ?? '○';
    const label  = STEP_LABELS[step.stepName as keyof typeof STEP_LABELS] ?? step.stepName;
    const status = STEP_STATUS_LABELS[step.status as keyof typeof STEP_STATUS_LABELS] ?? step.status;

    const details = [
      step.startedAt   ? `Iniciado: ${formatDateTime(step.startedAt)}`   : null,
      step.completedAt ? `Concluído: ${formatDateTime(step.completedAt)}` : null,
      step.dueAt       ? `Prazo: ${formatDate(step.dueAt)}`              : null,
      step.assignedUser ? `Responsável: ${step.assignedUser.name}`       : null,
    ].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');

    return `
    <tr style="${isDelayed ? 'background:#fff5f5;' : ''}">
      <td style="padding:8px ${isDelayed ? '8px' : '0'};vertical-align:top;${isDelayed ? 'border-left:3px solid #dc2626;' : ''}">
        <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:${bg};color:${color};font-size:12px;font-weight:700;">${icon}</span>
      </td>
      <td style="padding:8px 8px 8px ${isDelayed ? '10px' : '10px'};vertical-align:top;">
        <div style="font-size:13px;font-weight:700;color:#1a1f2e;">${label}
          <span style="font-size:11px;font-weight:600;color:${color};background:${bg};padding:2px 8px;border-radius:10px;margin-left:6px;">${status}</span>
          ${isDelayed && daysLate ? `<span style="font-size:11px;font-weight:700;color:#dc2626;margin-left:6px;">${daysLate} dia${daysLate > 1 ? 's' : ''} em atraso</span>` : ''}
        </div>
        ${details ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${details}</div>` : ''}
        ${step.notes ? `<div style="font-size:11px;color:#475569;margin-top:4px;font-style:italic;">"${step.notes}"</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Etapa em atraso</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

  <!-- Header -->
  <tr>
    <td style="background:#1a1f2e;padding:26px 36px;">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:700;">Paschoini Advogados</p>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Sistema interno de contratos</p>
    </td>
  </tr>

  <!-- Alerta vermelho -->
  <tr>
    <td style="background:#fee2e2;border-bottom:2px solid #fca5a5;padding:16px 36px;">
      <p style="margin:0;color:#991b1b;font-size:15px;font-weight:700;">
        ⚠&nbsp; Etapa em atraso: ${stepLabel}
      </p>
      ${daysLate ? `<p style="margin:4px 0 0;color:#b91c1c;font-size:13px;">${daysLate} dia${daysLate > 1 ? 's' : ''} além do prazo estabelecido</p>` : ''}
    </td>
  </tr>

  <!-- Corpo -->
  <tr><td style="padding:32px 36px;">

    ${sectionTitle('Dados da Empresa')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Razão Social', c.name)}
      ${row('CNPJ / CPF', c.document)}
      ${row('E-mail', c.email)}
      ${row('Telefone', c.phone)}
      ${row('Endereço', address)}
    </table>

    ${c.contactName || c.contactEmail ? `
    ${sectionTitle('Contato Responsável')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Nome', c.contactName)}
      ${row('E-mail', c.contactEmail)}
      ${row('Telefone', c.contactPhone)}
    </table>` : ''}

    ${sectionTitle('Dados do Contrato')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Deal Pipedrive', d?.title ?? null)}
      ${row('ID do Deal', d?.externalDealId ? `#${d.externalDealId}` : null)}
      ${row('Tipo de Serviço', d?.tipoServico ?? null)}
      ${row('Valor', d?.value ? formatCurrency(d.value) : null)}
      ${row('Proposta aceita em', tracking.proposalAcceptedAt ? formatDate(tracking.proposalAcceptedAt) : null)}
      ${row('Responsável interno', tracking.assignedUser?.name ?? null)}
    </table>

    ${sectionTitle('Etapa em Atraso')}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fca5a5;border-radius:8px;">
      <tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row('Etapa', stepLabel)}
          ${row('Iniciada em', delayedStep.startedAt ? formatDateTime(delayedStep.startedAt) : null)}
          ${row('Prazo era', delayedStep.dueAt ? formatDate(delayedStep.dueAt) : null)}
          ${row('Dias em atraso', daysLate ? `<span style="color:#dc2626;font-weight:700;">${daysLate} dia${daysLate > 1 ? 's' : ''}</span>` : null)}
          ${row('Responsável', delayedStep.assignedUser?.name ?? null)}
          ${row('Observação', delayedStep.notes ?? null)}
        </table>
      </td></tr>
    </table>

    ${sectionTitle('Linha do Tempo')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${stepsHtml}
    </table>

    <!-- Link para o contrato -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#1a1f2e;border-radius:7px;">
                <a href="${contractUrl}"
                   style="display:inline-block;padding:13px 32px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;">
                  → Ver contrato no sistema
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 36px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
        Paschoini Advogados &middot; Sistema interno de contratos &middot; Notificação automática
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildNewLeadEmailHtml(tracking: any, stepLabel: string, contractUrl: string, stepName?: string): string {
  const c = tracking.customer;
  const d = tracking.pipedriveDeal;

  const stepsHtml = tracking.steps.map((step: any) => {
    const color = STEP_STATUS_COLOR[step.status] ?? '#94a3b8';
    const bg    = STEP_STATUS_BG[step.status]    ?? '#f1f5f9';
    const icon  = STEP_STATUS_ICON[step.status]  ?? '○';
    const label = STEP_LABELS[step.stepName as keyof typeof STEP_LABELS] ?? step.stepName;
    const statusLabel = STEP_STATUS_LABELS[step.status as keyof typeof STEP_STATUS_LABELS] ?? step.status;
    return `<tr>
      <td style="padding:6px 0;">
        <span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:${bg};color:${color};font-size:13px;font-weight:700;text-align:center;line-height:24px;margin-right:10px;">${icon}</span>
        <span style="font-size:13px;color:${color};font-weight:600;">${label}</span>
        <span style="font-size:12px;color:#94a3b8;margin-left:8px;">${statusLabel}</span>
      </td>
    </tr>`;
  }).join('');

  // Signatários Clicksign — exibidos apenas na etapa de Assinatura
  const csDoc = tracking.clicksignDocs?.[0] ?? null;
  const csSigners: any[] = csDoc?.rawPayload?.signers ?? [];
  const isSigningStep = stepName === 'CONTRACT_SIGNING';

  const signersBlockHtml = isSigningStep && csSigners.length > 0 ? `
      ${sectionTitle('Signatários do Contrato')}
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <td style="padding:8px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Nome</td>
            <td style="padding:8px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">E-mail</td>
            <td style="padding:8px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;text-align:right;">Status</td>
          </tr>
        </thead>
        <tbody>
          ${csSigners.map((s: any) => {
            const signed = s.status === 'signed' || !!s.signed_at;
            return `<tr style="border-top:1px solid #f1f5f9;">
              <td style="padding:9px 14px;font-size:13px;color:#1a1f2e;font-weight:600;">${s.name ?? '—'}</td>
              <td style="padding:9px 14px;font-size:12px;color:#475569;">${s.email ?? '—'}</td>
              <td style="padding:9px 14px;text-align:right;">
                <span style="font-size:11px;font-weight:700;color:${signed ? '#16a34a' : '#d97706'};background:${signed ? '#dcfce7' : '#fef3c7'};padding:3px 10px;border-radius:10px;">
                  ${signed ? '✓ Assinado' : '⏳ Aguardando'}
                </span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : (isSigningStep ? `
      <p style="margin:16px 0 0;background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:4px;font-size:13px;color:#92400e;">
        ⏳ O envelope no Clicksign ainda está sendo criado. Acesse o sistema para acompanhar os signatários.
      </p>` : '');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

  <!-- Header -->
  <tr>
    <td style="background:#1a1f2e;padding:28px 36px;">
      <p style="margin:0;color:#fff;font-size:22px;font-weight:700;">Paschoini Advogados</p>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;">Sistema de Contratos</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px 36px;">

      <p style="margin:0 0 8px;background:#dbeafe;border-left:4px solid #3b82f6;padding:12px 16px;border-radius:6px;font-size:14px;color:#1e40af;font-weight:600;">
        🔔 Novo registro na etapa: ${stepLabel}
      </p>

      ${sectionTitle('Cliente')}
      <table width="100%" cellpadding="0" cellspacing="0">
        ${row('Nome', c?.name ?? null)}
        ${row('CPF/CNPJ', c?.document ?? null)}
        ${row('E-mail', c?.email ?? null)}
        ${row('Telefone', c?.phone ?? null)}
      </table>

      ${sectionTitle('Dados do Contrato')}
      <table width="100%" cellpadding="0" cellspacing="0">
        ${row('Deal Pipedrive', d?.title ?? null)}
        ${row('Tipo de Serviço', d?.tipoServico ?? null)}
        ${row('Valor', d?.value ? formatCurrency(d.value) : null)}
        ${row('Proposta aceita em', tracking.proposalAcceptedAt ? formatDate(tracking.proposalAcceptedAt) : null)}
        ${row('Responsável interno', tracking.assignedUser?.name ?? null)}
      </table>

      ${sectionTitle('Etapas')}
      <table width="100%" cellpadding="0" cellspacing="0">${stepsHtml}</table>

      ${signersBlockHtml}

      <br/>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#1a1f2e;border-radius:7px;">
            <a href="${contractUrl}"
               style="display:inline-block;padding:13px 32px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;">
              → Ver contrato no sistema
            </a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 36px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
        Paschoini Advogados &middot; Sistema interno de contratos &middot; Notificação automática
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildEmailHtml(tracking: any, actionUrl: string): string {
  const c  = tracking.customer;
  const d  = tracking.pipedriveDeal;
  const cs = tracking.clicksignDocs?.[0];

  // ── Endereço ──────────────────────────────────────────────────────────────
  const addressParts = [c.address, c.city, c.state && c.city ? `/${c.state}` : c.state, c.zipCode ? `CEP ${c.zipCode}` : null].filter(Boolean);
  const address = addressParts.join(' ') || null;

  // ── Clicksign signatários ─────────────────────────────────────────────────
  const csSigners: any[] = cs?.rawPayload?.signers ?? [];
  const csStatusLabel: Record<string, string> = { draft: 'Rascunho', running: 'Aguardando assinaturas', closed: 'Assinado', canceled: 'Cancelado' };
  const csStatusColor: Record<string, string> = { draft: '#64748b', running: '#d97706', closed: '#16a34a', canceled: '#dc2626' };

  // ── Steps timeline ────────────────────────────────────────────────────────
  const stepsHtml = tracking.steps.map((step: any) => {
    const color  = STEP_STATUS_COLOR[step.status] ?? '#94a3b8';
    const bg     = STEP_STATUS_BG[step.status]    ?? '#f1f5f9';
    const icon   = STEP_STATUS_ICON[step.status]  ?? '○';
    const label  = STEP_LABELS[step.stepName as keyof typeof STEP_LABELS] ?? step.stepName;
    const status = STEP_STATUS_LABELS[step.status as keyof typeof STEP_STATUS_LABELS] ?? step.status;

    const details = [
      step.startedAt   ? `Iniciado: ${formatDateTime(step.startedAt)}`   : null,
      step.completedAt ? `Concluído: ${formatDateTime(step.completedAt)}` : null,
      step.dueAt && step.status !== StepStatus.COMPLETED ? `Prazo: ${formatDate(step.dueAt)}` : null,
      step.assignedUser ? `Responsável: ${step.assignedUser.name}` : null,
    ].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');

    return `
    <tr>
      <td style="padding:8px 0;vertical-align:top;">
        <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:${bg};color:${color};font-size:12px;font-weight:700;">${icon}</span>
      </td>
      <td style="padding:8px 0 8px 10px;vertical-align:top;">
        <div style="font-size:13px;font-weight:700;color:#1a1f2e;">${label}
          <span style="font-size:11px;font-weight:600;color:${color};background:${bg};padding:2px 8px;border-radius:10px;margin-left:6px;">${status}</span>
        </div>
        ${details ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${details}</div>` : ''}
        ${step.notes ? `<div style="font-size:11px;color:#475569;margin-top:4px;font-style:italic;">"${step.notes}"</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  // ── Signatários Clicksign ─────────────────────────────────────────────────
  const signersHtml = csSigners.length > 0 ? csSigners.map((s: any) => {
    const signed = s.status === 'signed' || s.signed_at;
    return `
    <tr>
      <td style="padding:5px 0;font-size:13px;color:#1a1f2e;">${s.name}</td>
      <td style="padding:5px 0;font-size:12px;color:#64748b;">${s.email}</td>
      <td style="padding:5px 0;text-align:right;">
        <span style="font-size:11px;font-weight:600;color:${signed ? '#16a34a' : '#d97706'};background:${signed ? '#dcfce7' : '#fef3c7'};padding:2px 8px;border-radius:10px;">
          ${signed ? '✓ Assinado' : '⏳ Pendente'}
        </span>
        ${s.signed_at ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px;">${formatDateTime(s.signed_at)}</div>` : ''}
      </td>
    </tr>`;
  }).join('') : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cadastro de contrato pendente</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

  <!-- Header -->
  <tr>
    <td style="background:#1a1f2e;padding:26px 36px;">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:700;">Paschoini Advogados</p>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Sistema interno de contratos</p>
    </td>
  </tr>

  <!-- Alerta -->
  <tr>
    <td style="background:#fef9c3;border-bottom:2px solid #fde047;padding:16px 36px;">
      <p style="margin:0;color:#854d0e;font-size:14px;font-weight:600;">
        ⚠ Cadastro de contrato pendente — ação necessária
      </p>
    </td>
  </tr>

  <!-- Corpo -->
  <tr><td style="padding:32px 36px;">

    <p style="margin:0 0 4px;color:#64748b;font-size:13px;">
      O contrato abaixo concluiu a etapa de <strong>Assinatura</strong> e aguarda o cadastro para avançar para <strong>Faturamento</strong>.
    </p>

    ${sectionTitle('Dados da Empresa')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Razão Social', c.name)}
      ${row('CNPJ / CPF', c.document)}
      ${row('E-mail', c.email)}
      ${row('Telefone', c.phone)}
      ${row('Endereço', address)}
    </table>

    ${c.contactName || c.contactEmail ? `
    ${sectionTitle('Contato Responsável')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Nome', c.contactName)}
      ${row('E-mail', c.contactEmail)}
      ${row('Telefone', c.contactPhone)}
    </table>` : ''}

    ${sectionTitle('Dados do Contrato')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Deal Pipedrive', d?.title ?? null)}
      ${row('ID do Deal', d?.externalDealId ? `#${d.externalDealId}` : null)}
      ${row('Tipo de Serviço', d?.tipoServico ?? null)}
      ${row('Valor', d?.value ? formatCurrency(d.value) : null)}
      ${row('Proposta aceita em', tracking.proposalAcceptedAt ? formatDate(tracking.proposalAcceptedAt) : null)}
      ${row('Responsável interno', tracking.assignedUser?.name ?? null)}
    </table>

    ${sectionTitle('Linha do Tempo')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${stepsHtml}
    </table>

    ${cs ? `
    ${sectionTitle('Assinatura Clicksign')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Status', `<span style="color:${csStatusColor[cs.status] ?? '#64748b'};font-weight:700;">${csStatusLabel[cs.status] ?? cs.status}</span>`)}
      ${row('Envelope ID', cs.externalEnvelopeId ?? null)}
      ${row('Enviado em', cs.sentAt ? formatDateTime(cs.sentAt) : null)}
      ${row('Assinado em', cs.signedAt ? formatDateTime(cs.signedAt) : null)}
    </table>
    ${signersHtml ? `
    <p style="margin:14px 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Signatários</p>
    <table width="100%" cellpadding="0" cellspacing="0">${signersHtml}</table>` : ''}` : ''}

    <!-- CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0 8px;">
      <tr>
        <td align="center">
          <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
            Após realizar o cadastro, clique no botão abaixo para confirmar e avançar o contrato para <strong>Faturamento</strong>.
          </p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#0d6efd;border-radius:7px;">
                <a href="${actionUrl}"
                   style="display:inline-block;padding:16px 40px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">
                  ✓&nbsp; Informar cadastro do contrato
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;">
            Link válido por ${ACTION_EXPIRY_DAYS} dias. Se não esperava este e-mail, ignore-o.
          </p>
        </td>
      </tr>
    </table>

  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 36px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
        Paschoini Advogados &middot; Sistema interno de contratos
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
