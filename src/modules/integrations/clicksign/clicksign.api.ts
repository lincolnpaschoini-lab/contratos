import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

function baseUrl() {
  return env.CLICKSIGN_API_URL.replace(/\/$/, '');
}

async function apiCall<T>(method: string, path: string, body?: object): Promise<T> {
  const url = `${baseUrl()}/api/v1${path}?access_token=${env.CLICKSIGN_API_KEY ?? ''}`;
  const urlSafe = `${baseUrl()}/api/v1${path}?access_token=***`;

  logger.info(`Clicksign API ${method} ${urlSafe}`);

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Clicksign API ${method} ${path}: ${res.status} — ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

export interface ClicksignDocumentResponse {
  document: {
    key: string;
    status: string;
    filename: string;
  };
}

export interface ClicksignSigner {
  name: string;
  email: string;
  auth_action: 'email' | 'sms' | 'whatsapp' | 'pix';
}

export async function createDocumentFromTemplate(
  templateKey: string,
  message: string,
): Promise<ClicksignDocumentResponse> {
  return apiCall<ClicksignDocumentResponse>('POST', '/documents', {
    document: {
      template: { data: { key: templateKey } },
      message,
      locale: 'pt-BR',
      auto_close: true,
      sequence_enabled: false,
    },
  });
}

export async function addSignerToDocument(
  documentKey: string,
  signer: ClicksignSigner,
): Promise<void> {
  await apiCall('POST', '/lists', {
    list: {
      document_key: documentKey,
      signer: {
        name: signer.name,
        email: signer.email,
        phone_number: '',
        auth_action: signer.auth_action,
        delivery: 'email',
        has_documentation: false,
      },
      sign_as: 'sign',
    },
  });
}
