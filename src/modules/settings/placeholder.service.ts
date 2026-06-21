import { prisma } from '../../config/database';

export interface SourceField {
  field: string;
  label: string;
  group: string;
}

export const SOURCE_FIELDS: SourceField[] = [
  { field: 'customer.name',                       label: 'Nome da empresa / cliente',                       group: 'Empresa' },
  { field: 'customer.document',                   label: 'CNPJ / CPF',                                     group: 'Empresa' },
  { field: 'customer.email',                      label: 'E-mail da empresa',                               group: 'Empresa' },
  { field: 'customer.phone',                      label: 'Telefone da empresa',                             group: 'Empresa' },
  { field: 'customer.contactName',                label: 'Nome do representante',                           group: 'Representante' },
  { field: 'customer.contactEmail',               label: 'E-mail do representante',                         group: 'Representante' },
  { field: 'customer.contactPhone',               label: 'Telefone do representante',                       group: 'Representante' },
  { field: 'customer.contactName|customer.name',  label: 'Representante (ou empresa se vazio)',             group: 'Representante' },
  { field: 'customer.address',                    label: 'Logradouro',                                      group: 'Endereço' },
  { field: 'customer.city',                       label: 'Cidade',                                          group: 'Endereço' },
  { field: 'customer.state',                      label: 'Estado (UF)',                                     group: 'Endereço' },
  { field: 'customer.zipCode',                    label: 'CEP',                                             group: 'Endereço' },
  { field: 'customer.country',                    label: 'País',                                            group: 'Endereço' },
  { field: 'pipedriveDeal.tipoServico',           label: 'Tipo de Serviço (Pipedrive)',                     group: 'Deal' },
  { field: 'pipedriveDeal.title',                 label: 'Título do Deal',                                  group: 'Deal' },
  { field: 'pipedriveDeal.value',                 label: 'Valor do contrato (número bruto, ex: 6000)',      group: 'Deal' },
  { field: 'pipedriveDeal.valueFormatted',        label: 'Valor do contrato formatado (ex: R$ 6.000,00)',   group: 'Deal' },
  { field: 'pipedriveDeal.currency',              label: 'Moeda (ex: BRL)',                                 group: 'Deal' },
];

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  all: 'Todos',
  PF:  'PF',
  PJ:  'PJ',
};

export function resolveSourceField(fieldPath: string, customer: any, deal: any): string {
  for (const part of fieldPath.split('|')) {
    const value = resolveSingleField(part.trim(), customer, deal);
    if (value) return value;
  }
  return '';
}

function resolveSingleField(field: string, customer: any, deal: any): string {
  const dot = field.indexOf('.');
  if (dot === -1) return '';
  const obj = field.substring(0, dot);
  const prop = field.substring(dot + 1);
  if (obj === 'customer') return String(customer?.[prop] ?? '').trim();
  if (obj === 'pipedriveDeal') {
    if (prop === 'valueFormatted') {
      const num = Number(deal?.value ?? 0);
      const currency = String(deal?.currency ?? 'BRL');
      try {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(num);
      } catch {
        return `${currency} ${num.toFixed(2).replace('.', ',')}`;
      }
    }
    return String(deal?.[prop] ?? '').trim();
  }
  return '';
}

export function getSourceFieldLabel(fieldPath: string): string {
  return SOURCE_FIELDS.find((f) => f.field === fieldPath)?.label ?? fieldPath;
}

export async function getAllMappings() {
  return prisma.clicksignFieldMapping.findMany({
    orderBy: [{ contractType: 'asc' }, { sourceField: 'asc' }, { clicksignPlaceholder: 'asc' }],
  });
}

export async function createMapping(data: {
  sourceField: string;
  clicksignPlaceholder: string;
  contractType: string;
}) {
  return prisma.clicksignFieldMapping.create({ data });
}

export async function deleteMapping(id: string) {
  return prisma.clicksignFieldMapping.delete({ where: { id } });
}

export async function updateMapping(id: string, data: {
  sourceField: string;
  clicksignPlaceholder: string;
  contractType: string;
}) {
  const m = await prisma.clicksignFieldMapping.findUnique({ where: { id } });
  if (!m) throw new Error('Mapeamento não encontrado');
  return prisma.clicksignFieldMapping.update({ where: { id }, data });
}

export async function toggleMappingActive(id: string) {
  const m = await prisma.clicksignFieldMapping.findUnique({ where: { id } });
  if (!m) throw new Error('Mapeamento não encontrado');
  return prisma.clicksignFieldMapping.update({ where: { id }, data: { active: !m.active } });
}
