import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
}

async function apiGet<T>(path: string): Promise<T | null> {
  const token = env.PIPEDRIVE_API_TOKEN;
  const domain = env.PIPEDRIVE_DOMAIN;

  if (!token || !domain) {
    logger.warn('Pipedrive API: PIPEDRIVE_API_TOKEN ou PIPEDRIVE_DOMAIN ausentes');
    console.warn('[PIPEDRIVE API] Token ou domínio não configurados. Token:', !!token, 'Domain:', !!domain);
    return null;
  }

  // Monta URL sem URLSearchParams para máxima compatibilidade
  const url = `https://${domain}/api/v1${path}?api_token=${token}`;
  const urlSafe = `https://${domain}/api/v1${path}?api_token=***`;

  console.log(`[PIPEDRIVE API] GET ${urlSafe}`);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });

    console.log(`[PIPEDRIVE API] Status: ${res.status} para ${urlSafe}`);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn(`Pipedrive API: ${res.status} em ${path} — ${body.slice(0, 200)}`);
      console.warn(`[PIPEDRIVE API] Erro ${res.status}:`, body.slice(0, 300));
      return null;
    }

    const json = (await res.json()) as ApiResponse<T>;
    console.log(`[PIPEDRIVE API] Sucesso em ${urlSafe}, success=${json?.success}`);
    return json?.data ?? null;
  } catch (err: any) {
    logger.error(`Pipedrive API: exceção em ${path} — ${err.message}`, { stack: err.stack });
    console.error(`[PIPEDRIVE API] Exceção em ${path}:`, err.message, err.stack);
    return null;
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PipedriveEmailPhone {
  value: string;
  primary: boolean;
  label?: string;
}

export interface PipedriveAddress {
  value?: string;
  country?: string;
  admin_area_level_1?: string;
  locality?: string;
  sublocality?: string;
  route?: string;
  street_number?: string;
  postal_code?: string;
}

export interface PipedriveOrganization {
  id: number;
  name: string;
  address?: string | PipedriveAddress;  // v1: string flat, v2: objeto
  email?: string | PipedriveEmailPhone[];
  phone?: string | PipedriveEmailPhone[];
  // Campos v1 flat (fallback)
  address_formatted_address?: string;
  address_locality?: string;
  address_admin_area_level_1?: string;
  address_postal_code?: string;
  address_country?: string;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PipedrivePerson {
  id: number;
  name: string;
  email?: PipedriveEmailPhone[];
  phone?: PipedriveEmailPhone[];
  emails?: PipedriveEmailPhone[];  // alias v2
  phones?: PipedriveEmailPhone[];  // alias v2
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PipedriveField {
  id: number;
  key: string;         // hash ou nome padrão
  name: string;        // label legível (ex: "CNPJ")
  field_type: string;
}

// ─── Funções de busca ─────────────────────────────────────────────────────────

export async function fetchOrganization(orgId: number | string): Promise<PipedriveOrganization | null> {
  const data = await apiGet<PipedriveOrganization>(`/organizations/${orgId}`);
  if (data) logger.info(`Pipedrive: org ${orgId} recuperada — ${data.name}`);
  return data;
}

export async function fetchPerson(personId: number | string): Promise<PipedrivePerson | null> {
  const data = await apiGet<PipedrivePerson>(`/persons/${personId}`);
  if (data) logger.info(`Pipedrive: pessoa ${personId} recuperada — ${data.name}`);
  return data;
}

/** Retorna todas as definições de campos de organizações (padrão + customizados). */
export async function fetchOrganizationFields(): Promise<PipedriveField[]> {
  const data = await apiGet<PipedriveField[]>('/organizationFields');
  return data ?? [];
}

/** Retorna todas as definições de campos de pessoas. */
export async function fetchPersonFields(): Promise<PipedriveField[]> {
  const data = await apiGet<PipedriveField[]>('/personFields');
  return data ?? [];
}

/**
 * Monta um objeto { label: value } com todos os campos não-nulos da org,
 * incluindo os campos customizados com seus nomes legíveis.
 */
export function buildLabeledFields(
  orgData: Record<string, unknown>,
  fields: PipedriveField[],
): Record<string, string> {
  const fieldMap = new Map(fields.map((f) => [f.key, f.name]));
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(orgData)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object') continue; // ignora objetos aninhados

    const label = fieldMap.get(key) ?? key;
    result[label] = String(value);
  }

  return result;
}

/**
 * Detecta automaticamente o valor do CNPJ/CPF nos campos da organização.
 * Procura por campos com nome contendo "cnpj", "cpf", "documento" ou "tax".
 */
export function detectDocument(
  orgData: Record<string, unknown>,
  fields: PipedriveField[],
): string | null {
  const CNPJ_KEYWORDS = ['cnpj', 'cpf', 'documento', 'tax', 'vat', 'nif', 'fiscal'];

  for (const field of fields) {
    const nameLower = field.name.toLowerCase();
    if (CNPJ_KEYWORDS.some((kw) => nameLower.includes(kw))) {
      const value = orgData[field.key];
      if (value && typeof value === 'string') return value;
      if (value && typeof value === 'number') return String(value);
    }
  }
  return null;
}

// ─── Helpers de extração ──────────────────────────────────────────────────────

export function extractPrimaryEmail(
  emails?: PipedriveEmailPhone[] | string | null,
): string | null {
  if (!emails) return null;
  if (typeof emails === 'string') return emails || null;
  if (!Array.isArray(emails) || emails.length === 0) return null;
  return emails.find((e) => e.primary)?.value ?? emails[0]?.value ?? null;
}

export function extractPrimaryPhone(
  phones?: PipedriveEmailPhone[] | string | null,
): string | null {
  if (!phones) return null;
  if (typeof phones === 'string') return phones || null;
  if (!Array.isArray(phones) || phones.length === 0) return null;
  return phones.find((p) => p.primary)?.value ?? phones[0]?.value ?? null;
}

export function extractAddress(org: PipedriveOrganization): {
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
} {
  // Tenta v1 flat primeiro (mais comum)
  if (org.address_formatted_address || org.address_locality) {
    return {
      address: org.address_formatted_address ?? null,
      city: org.address_locality ?? null,
      state: org.address_admin_area_level_1 ?? null,
      zipCode: org.address_postal_code ?? null,
      country: org.address_country ?? null,
    };
  }

  // Tenta v2 objeto aninhado
  const addr = org.address;
  if (!addr) return { address: null, city: null, state: null, zipCode: null, country: null };

  if (typeof addr === 'string') {
    return { address: addr || null, city: null, state: null, zipCode: null, country: null };
  }

  return {
    address: addr.value ?? null,
    city: addr.locality ?? null,
    state: addr.admin_area_level_1 ?? null,
    zipCode: addr.postal_code ?? null,
    country: addr.country ?? null,
  };
}
