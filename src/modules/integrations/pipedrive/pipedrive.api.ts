import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

// API v2 — versão recomendada pelo Pipedrive
const getBaseUrl = () => `https://${env.PIPEDRIVE_DOMAIN}/api/v2`;

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
}

async function apiGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!env.PIPEDRIVE_API_TOKEN || !env.PIPEDRIVE_DOMAIN) {
    logger.debug('Pipedrive API: PIPEDRIVE_API_TOKEN ou PIPEDRIVE_DOMAIN não configurados');
    return null;
  }

  try {
    const qs = new URLSearchParams({
      api_token: env.PIPEDRIVE_API_TOKEN,
      ...params,
    });
    const url = `${getBaseUrl()}${path}?${qs}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      logger.warn(`Pipedrive API: ${res.status} em GET ${path}`);
      return null;
    }

    const json = (await res.json()) as ApiResponse<T>;
    return json?.data ?? null;
  } catch (err: any) {
    logger.warn(`Pipedrive API: falha em ${path} — ${err.message}`);
    return null;
  }
}

// ─── Interfaces baseadas na API v2 ────────────────────────────────────────────

export interface PipedriveAddress {
  value?: string;              // endereço completo formatado
  country?: string;
  admin_area_level_1?: string; // estado / UF
  admin_area_level_2?: string; // região
  locality?: string;           // cidade
  sublocality?: string;        // bairro
  route?: string;              // rua / logradouro
  street_number?: string;
  postal_code?: string;        // CEP
}

export interface PipedriveEmailPhone {
  value: string;
  primary: boolean;
  label?: string;
}

export interface PipedriveOrganization {
  id: number;
  name: string;
  address?: PipedriveAddress;
  // v1 pode retornar email/phone como string ou array — tratamos ambos
  email?: string | PipedriveEmailPhone[];
  phone?: string | PipedriveEmailPhone[];
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PipedrivePerson {
  id: number;
  name: string;
  emails?: PipedriveEmailPhone[];  // v2: campo é "emails" (plural)
  phones?: PipedriveEmailPhone[];  // v2: campo é "phones" (plural)
  // compatibilidade v1
  email?: PipedriveEmailPhone[];
  phone?: PipedriveEmailPhone[];
  job_title?: string;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Funções de busca ─────────────────────────────────────────────────────────

export async function fetchOrganization(orgId: number | string): Promise<PipedriveOrganization | null> {
  const data = await apiGet<PipedriveOrganization>(`/organizations/${orgId}`, {
    include_fields: 'address,email,phone,custom_fields',
  });
  if (data) logger.info(`Pipedrive: org ${orgId} recuperada — ${data.name}`);
  return data;
}

export async function fetchPerson(personId: number | string): Promise<PipedrivePerson | null> {
  const data = await apiGet<PipedrivePerson>(`/persons/${personId}`, {
    include_fields: 'emails,phones,custom_fields',
  });
  if (data) logger.info(`Pipedrive: pessoa ${personId} recuperada — ${data.name}`);
  return data;
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

/**
 * Extrai o endereço de uma organização (v2 retorna objeto aninhado).
 */
export function extractAddress(org: PipedriveOrganization): {
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
} {
  const addr = org.address;
  if (!addr) return { address: null, city: null, state: null, zipCode: null, country: null };

  return {
    address: addr.value ?? buildAddressString(addr),
    city: addr.locality ?? null,
    state: addr.admin_area_level_1 ?? null,
    zipCode: addr.postal_code ?? null,
    country: addr.country ?? null,
  };
}

function buildAddressString(addr: PipedriveAddress): string | null {
  const parts = [
    addr.route,
    addr.street_number,
    addr.sublocality,
    addr.locality,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}
