import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

function baseUrl() {
  return `${env.CLICKSIGN_API_URL.replace(/\/$/, '')}/api/v3`;
}

const HEADERS = () => ({
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/vnd.api+json',
  'Authorization': env.CLICKSIGN_API_KEY ?? '',
});

async function apiCall<T>(method: string, path: string, body?: object): Promise<T> {
  const url = `${baseUrl()}${path}`;
  console.log(`[CLICKSIGN API] ${method} ${path}`);
  logger.info(`Clicksign API ${method} ${path}`);

  const res = await fetch(url, {
    method,
    headers: HEADERS(),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[CLICKSIGN API] ERRO ${method} ${path}: ${res.status} — ${text.slice(0, 400)}`);
    throw new Error(`Clicksign ${method} ${path}: ${res.status} — ${text.slice(0, 400)}`);
  }
  console.log(`[CLICKSIGN API] OK ${res.status} — ${method} ${path}`);

  // PATCH /envelopes/{id} pode retornar 200 sem body
  if (res.status === 204 || res.headers.get('content-length') === '0') return {} as T;

  try {
    return await res.json() as T;
  } catch {
    return {} as T;
  }
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ClicksignEnvelope {
  data: {
    id: string;
    type: 'envelopes';
    attributes: {
      name: string;
      status: 'draft' | 'running' | 'closed' | 'canceled';
      created_at: string;
      updated_at: string;
    };
  };
}

export interface ClicksignSigner {
  name: string;
  email: string;
}

// ─── Funções da API v3 ────────────────────────────────────────────────────────

/** Cria um envelope em rascunho. Retorna o envelope_id. */
export async function createEnvelope(name: string, message: string): Promise<string> {
  const res = await apiCall<ClicksignEnvelope>('POST', '/envelopes', {
    data: {
      type: 'envelopes',
      attributes: {
        name,
        locale: 'pt-BR',
        auto_close: true,
        block_after_refusal: true,
        default_message: message,
      },
    },
  });
  return res.data.id;
}

/** Adiciona um documento a partir de um template Clicksign. Retorna o document_id. */
export async function addDocumentFromTemplate(envelopeId: string, templateKey: string, filename: string): Promise<string> {
  const res = await apiCall<{ data: { id: string } }>('POST', `/envelopes/${envelopeId}/documents`, {
    data: {
      type: 'documents',
      attributes: {
        filename,
        template: {
          key: templateKey,
          data: {},
        },
      },
    },
  });
  return res.data.id;
}

/** Adiciona um signatário ao envelope. Retorna o signer_id. */
export async function addSigner(envelopeId: string, signer: ClicksignSigner): Promise<string> {
  const res = await apiCall<{ data: { id: string } }>('POST', `/envelopes/${envelopeId}/signers`, {
    data: {
      type: 'signers',
      attributes: {
        name: signer.name,
        email: signer.email,
        has_documentation: false,
        refusable: false,
        group: 1, // mesmo grupo = assinatura simultânea
      },
    },
  });
  return res.data.id;
}

/** Cria um requisito de assinatura vinculando signatário a documento via email. */
export async function addRequirement(envelopeId: string, documentId: string, signerId: string): Promise<void> {
  await apiCall('POST', `/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: {
        action: 'provide_evidence',
        auth: 'email',
      },
      relationships: {
        document: { data: { type: 'documents', id: documentId } },
        signer: { data: { type: 'signers', id: signerId } },
      },
    },
  });
}

/** Ativa o envelope (draft → running), disparando os emails para os signatários. */
export async function activateEnvelope(envelopeId: string): Promise<void> {
  await apiCall('PATCH', `/envelopes/${envelopeId}`, {
    data: {
      id: envelopeId,
      type: 'envelopes',
      attributes: { status: 'running' },
    },
  });
}

/** Busca os detalhes atuais de um envelope (status, datas, etc.). */
export async function getEnvelope(envelopeId: string): Promise<ClicksignEnvelope> {
  return apiCall<ClicksignEnvelope>('GET', `/envelopes/${envelopeId}`);
}
