import { env } from '../../config/env';
import { logger } from '../../config/logger';

const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`;
const SEND_MAIL_ENDPOINT = `https://graph.microsoft.com/v1.0/users/${env.GRAPH_SENDER_EMAIL}/sendMail`;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph: falha na autenticação — ${res.status} ${err}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const token = await getAccessToken();

  const payload = {
    message: {
      subject: params.subject,
      body: { contentType: 'HTML', content: params.html },
      toRecipients: [{ emailAddress: { address: params.to } }],
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
    throw new Error(`Graph: falha ao enviar e-mail — ${res.status} ${err}`);
  }

  logger.info(`Graph: e-mail enviado para ${params.to} — "${params.subject}"`);
}
