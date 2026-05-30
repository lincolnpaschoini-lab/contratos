import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { sendMail } from './graph-mailer';

const ACTION_EXPIRY_DAYS = 30;

/** Dispara notificação de cadastro pendente. Idempotente: não reenvia se já existe token ativo. */
export async function sendRegistrationActionEmail(trackingId: string): Promise<void> {
  if (!env.GRAPH_CLIENT_ID || !env.GRAPH_CLIENT_SECRET || !env.REGISTRATION_NOTIFY_EMAIL) {
    logger.warn('[EMAIL] Notificação de cadastro ignorada — GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET ou REGISTRATION_NOTIFY_EMAIL não configurados');
    return;
  }

  // Idempotência: não cria novo token se já existe um ativo para este contrato
  const existing = await prisma.actionToken.findFirst({
    where: {
      trackingId,
      action: 'complete_registration',
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (existing) {
    logger.info(`[EMAIL] Token de cadastro já existe para ${trackingId} — e-mail não reenviado`);
    return;
  }

  const tracking = await prisma.contractTracking.findUnique({
    where: { id: trackingId },
    include: {
      customer: true,
      pipedriveDeal: true,
    },
  });

  if (!tracking) return;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ACTION_EXPIRY_DAYS);

  const { token } = await prisma.actionToken.create({
    data: {
      trackingId,
      action: 'complete_registration',
      expiresAt,
      metadata: { customerName: tracking.customer.name },
    },
    select: { token: true },
  });

  const actionUrl = `${env.APP_URL}/acoes/cadastro/${token}`;

  await sendMail({
    to: env.REGISTRATION_NOTIFY_EMAIL,
    subject: `Cadastro de contrato pendente — ${tracking.customer.name}`,
    html: buildEmailHtml({
      customerName: tracking.customer.name,
      dealTitle: tracking.pipedriveDeal?.title ?? '',
      actionUrl,
    }),
  });

  logger.info(`[EMAIL] Notificação de cadastro enviada para ${env.REGISTRATION_NOTIFY_EMAIL} — tracking ${trackingId}`);
}

function buildEmailHtml(p: { customerName: string; dealTitle: string; actionUrl: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cadastro de contrato pendente</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.09);">

        <!-- Header -->
        <tr>
          <td style="background:#1a1f2e;padding:28px 36px;">
            <p style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:.01em;">Paschoini Advogados</p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Sistema interno de contratos</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px;">
            <h2 style="margin:0 0 6px;color:#1a1f2e;font-size:20px;font-weight:700;">Cadastro de contrato pendente</h2>
            <p style="margin:0 0 28px;color:#64748b;font-size:14px;line-height:1.6;">
              O contrato abaixo concluiu a etapa de assinatura e aguarda o cadastro para prosseguir para faturamento.
            </p>

            <!-- Card do cliente -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:32px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Cliente</p>
                  <p style="margin:0 0 6px;color:#1a1f2e;font-size:18px;font-weight:700;">${p.customerName}</p>
                  ${p.dealTitle ? `<p style="margin:0;color:#64748b;font-size:13px;">${p.dealTitle}</p>` : ''}
                </td>
              </tr>
            </table>

            <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.6;">
              Após realizar o cadastro no sistema, clique no botão abaixo para confirmar e avançar o contrato automaticamente para a etapa de <strong>Faturamento</strong>.
            </p>

            <!-- Botão CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="background:#0d6efd;border-radius:7px;">
                  <a href="${p.actionUrl}"
                     style="display:inline-block;padding:15px 36px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:.01em;">
                    ✓&nbsp; Informar cadastro do contrato
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;line-height:1.5;">
              Este link é válido por ${ACTION_EXPIRY_DAYS} dias. Se você não esperava este e-mail, pode ignorá-lo com segurança.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 36px;">
            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
              Paschoini Advogados · Sistema interno de contratos
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
