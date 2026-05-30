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

/** Adiciona um documento a partir de um template Clicksign preenchendo as variáveis. Retorna o document_id. */
export async function addDocumentFromTemplate(
  envelopeId: string,
  templateKey: string,
  filename: string,
  templateData: Record<string, string> = {},
): Promise<string> {
  const res = await apiCall<{ data: { id: string } }>('POST', `/envelopes/${envelopeId}/documents`, {
    data: {
      type: 'documents',
      attributes: {
        filename,
        template: {
          key: templateKey,
          data: templateData,
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

/** Cria os dois requisitos necessários por signatário: autenticação (email) + assinatura (agree). */
export async function addRequirement(envelopeId: string, documentId: string, signerId: string): Promise<void> {
  const relationships = {
    document: { data: { type: 'documents', id: documentId } },
    signer: { data: { type: 'signers', id: signerId } },
  };

  // 1 — Requisito de autenticação via email
  await apiCall('POST', `/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: 'provide_evidence', auth: 'email' },
      relationships,
    },
  });

  // 2 — Requisito de assinatura (obrigatório para ativação do envelope)
  await apiCall('POST', `/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: 'agree', role: 'sign' },
      relationships,
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

export interface ClicksignSignerDetail {
  id: string;
  name: string;
  email: string;
  status: string;        // ex: "pending", "completed", "signed"
  signed_at: string | null;
}

export interface ClicksignRequirement {
  id: string;
  signerId: string;
  action: string;
  status: string;
  fulfilledAt: string | null;
}

/** Lista os requisitos do envelope (contém status de cumprimento por signatário). */
export async function listEnvelopeRequirements(envelopeId: string): Promise<ClicksignRequirement[]> {
  const res = await apiCall<{ data: Array<{ id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown> }> }>(
    'GET', `/envelopes/${envelopeId}/requirements`,
  );
  console.log('[CLICKSIGN REQUIREMENTS] Resposta bruta:', JSON.stringify(res?.data?.slice(0, 3), null, 2));
  return (res.data ?? []).map((r) => {
    const rel = r.relationships as any;
    return {
      id: r.id,
      signerId: String(rel?.signer?.data?.id ?? ''),
      action: String(r.attributes?.action ?? ''),
      status: String(r.attributes?.status ?? 'pending'),
      fulfilledAt: r.attributes?.fulfilled_at ? String(r.attributes.fulfilled_at) : null,
    };
  });
}

/** Lista os signatários de um envelope com seu status de assinatura. */
export async function listEnvelopeSigners(envelopeId: string): Promise<ClicksignSignerDetail[]> {
  const res = await apiCall<{ data: Array<{ id: string; attributes: Record<string, unknown> }> }>(
    'GET', `/envelopes/${envelopeId}/signers`,
  );

  // A API v3 não retorna status/signed_at diretamente nos signatários.
  // Detectamos se assinou comparando modified vs created: diferença > 60s = assinou.
  return (res.data ?? []).map((s) => {
    const attr = s.attributes ?? {};
    const createdAt  = attr.created  ? new Date(String(attr.created)).getTime()  : 0;
    const modifiedAt = attr.modified ? new Date(String(attr.modified)).getTime() : 0;
    const hasSigned  = (modifiedAt - createdAt) > 60_000;

    console.log(`[CLICKSIGN SIGNERS] ${attr.email}: created=${attr.created} modified=${attr.modified} hasSigned=${hasSigned}`);

    return {
      id: s.id,
      name:      String(attr.name  ?? ''),
      email:     String(attr.email ?? ''),
      status:    hasSigned ? 'signed' : 'pending',
      signed_at: hasSigned ? String(attr.modified) : null,
    };
  });
}
