import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
}

/** Contexto de API por empresa — quando ausente usa o config legado (Paschoini). */
export interface PipedriveApiContext {
  apiToken: string;
  domain: string;
  companyName?: string;
}

async function apiGet<T>(path: string, ctx?: PipedriveApiContext): Promise<T | null> {
  const token  = ctx?.apiToken || env.PIPEDRIVE_API_TOKEN;
  const domain = ctx?.domain   || env.PIPEDRIVE_DOMAIN;

  if (!token || !domain) {
    logger.warn('Pipedrive API: token ou domínio não configurados');
    console.warn('[PIPEDRIVE API] Token ou domínio ausentes. Empresa:', ctx?.companyName ?? 'default');
    return null;
  }

  const separator = path.includes('?') ? '&' : '?';
  const url     = `https://${domain}/api/v1${path}${separator}api_token=${token}`;
  const urlSafe = `https://${domain}/api/v1${path}${separator}api_token=***`;

  console.log(`[PIPEDRIVE API] GET ${urlSafe} (${ctx?.companyName ?? 'default'})`);

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
  options?: Array<{ id: number; label: string }>;
}

export interface PipedriveUser {
  id: number;
  name: string;
  email: string;
}

// ─── Funções de busca ─────────────────────────────────────────────────────────

export async function fetchPipedriveUser(userId: number | string, ctx?: PipedriveApiContext): Promise<PipedriveUser | null> {
  const data = await apiGet<PipedriveUser>(`/users/${userId}`, ctx);
  if (data) logger.info(`Pipedrive: usuário ${userId} recuperado — ${data.name}`);
  return data;
}

export async function fetchOrganization(orgId: number | string, ctx?: PipedriveApiContext): Promise<PipedriveOrganization | null> {
  const data = await apiGet<PipedriveOrganization>(`/organizations/${orgId}`, ctx);
  if (data) logger.info(`Pipedrive: org ${orgId} recuperada — ${data.name}`);
  return data;
}

export async function fetchPerson(personId: number | string, ctx?: PipedriveApiContext): Promise<PipedrivePerson | null> {
  const data = await apiGet<PipedrivePerson>(`/persons/${personId}`, ctx);
  if (data) logger.info(`Pipedrive: pessoa ${personId} recuperada — ${data.name}`);
  return data;
}

export async function fetchOrganizationFields(ctx?: PipedriveApiContext): Promise<PipedriveField[]> {
  const data = await apiGet<PipedriveField[]>('/organizationFields', ctx);
  return data ?? [];
}

export async function fetchPersonFields(ctx?: PipedriveApiContext): Promise<PipedriveField[]> {
  const data = await apiGet<PipedriveField[]>('/personFields', ctx);
  return data ?? [];
}

export async function fetchDealFields(ctx?: PipedriveApiContext): Promise<PipedriveField[]> {
  const data = await apiGet<PipedriveField[]>('/dealFields', ctx);
  return data ?? [];
}

/** Objeto completo de um deal via GET /deals/{id}. Campos customizados chegam no top-level com seu hash como chave. */
export interface PipedriveDealFull {
  id: number;
  title: string;
  value?: number;
  currency?: string;
  stage_id?: number;
  stage_name?: string;
  status?: string;
  [key: string]: unknown;
}

export async function fetchDeal(dealId: number | string, ctx?: PipedriveApiContext): Promise<PipedriveDealFull | null> {
  const data = await apiGet<PipedriveDealFull>(`/deals/${dealId}`, ctx);
  if (data) logger.info(`Pipedrive: deal ${dealId} recuperado via API — "${data.title}"`);
  return data;
}

export interface PipedriveSearchResult {
  id: number;
  name: string;
}

interface PipedriveSearchResponse {
  items: Array<{ item: { id: number; name: string } }>;
}

/** Busca leve (só id + nome) de pessoas pelo termo — usada no autocomplete de beneficiários. */
export async function searchPersons(term: string, ctx?: PipedriveApiContext): Promise<PipedriveSearchResult[]> {
  if (!term.trim()) return [];
  const data = await apiGet<PipedriveSearchResponse>(`/persons/search?term=${encodeURIComponent(term)}&fields=name`, ctx);
  return (data?.items ?? []).map((i) => ({ id: i.item.id, name: i.item.name }));
}

/** Busca leve (só id + nome) de organizações pelo termo — usada no autocomplete de beneficiários. */
export async function searchOrganizations(term: string, ctx?: PipedriveApiContext): Promise<PipedriveSearchResult[]> {
  if (!term.trim()) return [];
  const data = await apiGet<PipedriveSearchResponse>(`/organizations/search?term=${encodeURIComponent(term)}&fields=name`, ctx);
  return (data?.items ?? []).map((i) => ({ id: i.item.id, name: i.item.name }));
}

/**
 * Resolve o valor de um campo enum do Pipedrive para seu label legível.
 *
 * Trata três formatos que a API pode retornar:
 *  - Objeto { id, type } → webhook v2
 *  - String numérica ("12345") → REST API v1 retornando o option ID como string
 *  - String não-numérica → já é o label, retorna direto
 */
export function resolveDealEnumValue(
  rawValue: unknown,
  dealFields: PipedriveField[],
  fieldKey: string,
): string | null {
  if (!rawValue) return null;

  // Formato v2 webhook: { id: 31, type: "enum" }
  if (typeof rawValue === 'object' && rawValue !== null && 'id' in rawValue) {
    const enumId = (rawValue as { id: number }).id;
    const field = dealFields.find((f) => f.key === fieldKey);
    const option = field?.options?.find((o) => o.id === enumId);
    if (option) {
      logger.info(`Pipedrive: enum "${fieldKey}" id=${enumId} → "${option.label}"`);
      return option.label;
    }
    logger.warn(`Pipedrive: enum "${fieldKey}" id=${enumId} não encontrado nos fields`);
    return null;
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;

    // REST API v1 retorna enums como string numérica — tenta resolver pelo ID
    const numericId = Number(trimmed);
    if (!isNaN(numericId) && trimmed !== '') {
      const field = dealFields.find((f) => f.key === fieldKey);
      const option = field?.options?.find((o) => o.id === numericId);
      if (option) {
        logger.info(`Pipedrive: enum "${fieldKey}" id string="${trimmed}" → "${option.label}"`);
        return option.label;
      }
      // Não encontrou como ID — pode ser um campo texto que contém número
    }

    // Já é um label string legível
    return trimmed;
  }

  return null;
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
