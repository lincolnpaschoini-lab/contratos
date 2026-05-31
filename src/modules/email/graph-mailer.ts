import { env } from '../../config/env';
import { logger } from '../../config/logger';

const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`;
const SEND_MAIL_ENDPOINT = `https://graph.microsoft.com/v1.0/users/${env.GRAPH_SENDER_EMAIL}/sendMail`;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    logger.info('[GRAPH] Usando token em cache');
    return cachedToken.value;
  }

  logger.info(`[GRAPH] Solicitando token — tenant: ${env.GRAPH_TENANT_ID}, client: ${env.GRAPH_CLIENT_ID}`);
  logger.info(`[GRAPH] Endpoint de token: ${TOKEN_ENDPOINT}`);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.GRAPH_CLIENT_ID ?? '',
    client_secret: env.GRAPH_CLIENT_SECRET ?? '',
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const responseText = await res.text();
  logger.info(`[GRAPH] Resposta autenticação — status: ${res.status}, body: ${responseText.slice(0, 300)}`);

  if (!res.ok) {
    throw new Error(`Graph autenticação falhou — HTTP ${res.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  logger.info('[GRAPH] Token obtido com sucesso');
  return cachedToken.value;
}

export async function sendMail(params: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<void> {
  const token = await getAccessToken();

  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  logger.info(`[GRAPH] Enviando e-mail para ${recipients.join(', ')} — assunto: "${params.subject}"`);
  logger.info(`[GRAPH] Endpoint de envio: ${SEND_MAIL_ENDPOINT}`);

  const payload = {
    message: {
      subject: params.subject,
      body: { contentType: 'HTML', content: params.html },
      toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: false,
  };

  const res = await fetch(SEND_MAIL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error(`[GRAPH] Falha no envio — HTTP ${res.status}: ${err}`);
    throw new Error(`Graph sendMail falhou — HTTP ${res.status}: ${err}`);
  }

  logger.info(`[GRAPH] E-mail enviado com sucesso para ${recipients.join(', ')}`);
}
