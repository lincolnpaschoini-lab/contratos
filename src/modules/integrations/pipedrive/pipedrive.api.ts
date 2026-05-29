import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

// Usa a API v1 do Pipedrive — mais campos disponíveis que a v2
const getBaseUrl = () => `https://${env.PIPEDRIVE_DOMAIN}/api/v1`;

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
}

async function apiGet<T>(path: string): Promise<T | null> {
  if (!env.PIPEDRIVE_API_TOKEN || !env.PIPEDRIVE_DOMAIN) {
    logger.debug('Pipedrive API: PIPEDRIVE_API_TOKEN ou PIPEDRIVE_DOMAIN não configurados');
    return null;
  }

  try {
    const url = `${getBaseUrl()}${path}?api_token=${env.PIPEDRIVE_API_TOKEN}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!res.ok) {
      logger.warn(`Pipedrive API: ${res.status} em ${path}`);
      return null;
    }

    const json = (await res.json()) as ApiResponse<T>;
    return json?.data ?? null;
  } catch (err: any) {
    logger.warn(`Pipedrive API: falha em ${path} — ${err.message}`);
    return null;
  }
}

export interface PipedriveOrganization {
  id: number;
  name: string;
  address?: string;
  address_formatted_address?: string;
  address_street_number?: string;
  address_route?: string;
  address_locality?: string;         // cidade
  address_admin_area_level_1?: string; // estado
  address_postal_code?: string;
  address_country?: string;
  email?: string;
  phone?: string;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PipedrivePerson {
  id: number;
  name: string;
  email?: Array<{ value: string; primary: boolean; label: string }>;
  phone?: Array<{ value: string; primary: boolean; label: string }>;
  job_title?: string;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function fetchOrganization(orgId: number | string): Promise<PipedriveOrganization | null> {
  const data = await apiGet<PipedriveOrganization>(`/organizations/${orgId}`);
  if (data) logger.info(`Pipedrive API: organização ${orgId} recuperada — ${data.name}`);
  return data;
}

export async function fetchPerson(personId: number | string): Promise<PipedrivePerson | null> {
  const data = await apiGet<PipedrivePerson>(`/persons/${personId}`);
  if (data) logger.info(`Pipedrive API: pessoa ${personId} recuperada — ${data.name}`);
  return data;
}

// Extrai o e-mail primário de um array de e-mails do Pipedrive
export function extractPrimaryEmail(
  emails?: Array<{ value: string; primary: boolean }>,
): string | null {
  if (!emails?.length) return null;
  return emails.find((e) => e.primary)?.value ?? emails[0]?.value ?? null;
}

// Extrai o telefone primário
export function extractPrimaryPhone(
  phones?: Array<{ value: string; primary: boolean }>,
): string | null {
  if (!phones?.length) return null;
  return phones.find((p) => p.primary)?.value ?? phones[0]?.value ?? null;
}
