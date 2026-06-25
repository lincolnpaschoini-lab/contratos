import { prisma } from '../../config/database';

export interface SourceField {
  field: string;
  label: string;
  group: string;
}

export const SOURCE_FIELDS: SourceField[] = [
  // Empresa / Org (campos padrão)
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
  // Deal
  { field: 'pipedriveDeal.tipoServico',           label: 'Tipo de Serviço (Pipedrive)',                     group: 'Deal' },
  { field: 'pipedriveDeal.title',                 label: 'Título do Deal',                                  group: 'Deal' },
  { field: 'pipedriveDeal.value',                 label: 'Valor do contrato (número bruto, ex: 6000)',      group: 'Deal' },
  { field: 'pipedriveDeal.valueFormatted',        label: 'Valor do contrato formatado (ex: R$ 6.000,00)',   group: 'Deal' },
  { field: 'pipedriveDeal.currency',              label: 'Moeda (ex: BRL)',                                 group: 'Deal' },
  // Contratante PF — campos customizados da Pessoa no Pipedrive
  { field: 'personExtracted.nome',                label: 'Contratante PF — Nome completo',                  group: 'Contratante PF' },
  { field: 'personExtracted.cpf',                 label: 'Contratante PF — CPF',                            group: 'Contratante PF' },
  { field: 'personExtracted.rg',                  label: 'Contratante PF — RG',                             group: 'Contratante PF' },
  { field: 'personExtracted.dataExpDoc',          label: 'Contratante PF — Data de expedição do doc.',      group: 'Contratante PF' },
  { field: 'personExtracted.dataNascimento',      label: 'Contratante PF — Data de nascimento',             group: 'Contratante PF' },
  { field: 'personExtracted.estadoCivil',         label: 'Contratante PF — Estado civil',                   group: 'Contratante PF' },
  { field: 'personExtracted.nacionalidade',       label: 'Contratante PF — Nacionalidade',                  group: 'Contratante PF' },
  { field: 'personExtracted.profissao',           label: 'Contratante PF — Profissão',                      group: 'Contratante PF' },
  { field: 'personExtracted.enderecoCompleto',    label: 'Contratante PF — Endereço completo',              group: 'Contratante PF' },
  { field: 'personExtracted.telefone',            label: 'Contratante PF — Telefone (só números)',          group: 'Contratante PF' },
  { field: 'personExtracted.email',               label: 'Contratante PF — E-mail',                         group: 'Contratante PF' },
  // Contratante PJ — campos customizados da Organização no Pipedrive
  { field: 'orgExtracted.razaoSocial',            label: 'Contratante PJ — Razão social',                   group: 'Contratante PJ' },
  { field: 'orgExtracted.cnpj',                   label: 'Contratante PJ — CNPJ',                           group: 'Contratante PJ' },
  { field: 'orgExtracted.dataFundacao',           label: 'Contratante PJ — Data de fundação',               group: 'Contratante PJ' },
  { field: 'orgExtracted.endereco',               label: 'Contratante PJ — Endereço',                       group: 'Contratante PJ' },
  { field: 'orgExtracted.telefone',               label: 'Contratante PJ — Telefone',                       group: 'Contratante PJ' },
  { field: 'orgExtracted.email',                  label: 'Contratante PJ — E-mail',                         group: 'Contratante PJ' },
  // Campos do contrato (deal customizados)
  { field: 'dealExtracted.seVigenciaDeterminada',   label: 'Vigência Determinada (☑ ou ☐)',                group: 'Contrato' },
  { field: 'dealExtracted.seVigenciaIndeterminada', label: 'Vigência Indeterminada (☑ ou ☐)',              group: 'Contrato' },
  { field: 'dealExtracted.duracaoVigencia',         label: 'Duração da vigência determinada',              group: 'Contrato' },
  { field: 'dealExtracted.terminoVigencia',         label: 'Término da vigência (dd/mm/aaaa)',             group: 'Contrato' },
  { field: 'dealExtracted.areaContrato',            label: 'Área do contrato',                             group: 'Contrato' },
  { field: 'dealExtracted.descricaoContrato',       label: 'Descrição do contrato',                        group: 'Contrato' },
  { field: 'dealExtracted.seHonorarioFixo',         label: 'Honorário fixo (☑ ou ☐)',                     group: 'Contrato' },
  { field: 'dealExtracted.seAdExitum',              label: 'Ad exitum (☑ ou ☐)',                           group: 'Contrato' },
  { field: 'dealExtracted.detalhesHonorarioFixo',   label: 'Detalhes do honorário fixo',                   group: 'Contrato' },
  { field: 'dealExtracted.porcentagemAdExitum',     label: 'Porcentagem ad exitum',                        group: 'Contrato' },
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

  // Campos customizados extraídos da Pessoa (PF) — armazenados em customer.pipedrivePersonRaw._extracted
  if (obj === 'personExtracted') {
    const extracted = (customer?.pipedrivePersonRaw as any)?._extracted;
    return String(extracted?.[prop] ?? '').trim();
  }

  // Campos customizados extraídos da Organização (PJ) — armazenados em customer.pipedriveOrgRaw._extracted
  if (obj === 'orgExtracted') {
    const extracted = (customer?.pipedriveOrgRaw as any)?._extracted;
    return String(extracted?.[prop] ?? '').trim();
  }

  // Campos customizados extraídos do Deal — armazenados em pipedriveDeal.rawPayload._extracted
  if (obj === 'dealExtracted') {
    const extracted = (deal?.rawPayload as any)?._extracted;
    return String(extracted?.[prop] ?? '').trim();
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
