import { Request, Response } from 'express';
import { z } from 'zod';
import {
  getBeneficiaryFormData,
  searchPipedrive,
  selectPipedriveRecord,
  submitBeneficiaries,
} from './beneficiaries.service';

export async function getBeneficiaryForm(req: Request, res: Response) {
  const { token } = req.params;
  const result = await getBeneficiaryFormData(token);

  if ('error' in result) {
    return res.render('email-action/result', { layout: false, ...result.error });
  }

  const tracking = result.actionToken.contractTracking;
  return res.render('beneficiaries/form', {
    layout: false,
    token,
    customerName: tracking.customer.name,
    tipoServico: (tracking.pipedriveDeal as any)?.tipoServico ?? '',
  });
}

export async function getPipedriveSearch(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const type = req.query.type === 'pj' ? 'pj' : 'pf';
    const term = String(req.query.q ?? '');
    const results = await searchPipedrive(token, type, term);
    return res.json({ success: true, data: results });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function getPipedriveSelect(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const type = req.query.type === 'pj' ? 'pj' : 'pf';
    const id = String(req.query.id ?? '');
    const data = await selectPipedriveRecord(token, type, id);
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

const bodySchema = z.object({
  none: z.string().optional(),
  pf: z.array(z.object({
    nome: z.string().optional(),
    cpf: z.string().optional(),
    pipedrivePersonId: z.string().optional(),
  })).optional(),
  pj: z.array(z.object({
    razaoSocial: z.string().optional(),
    cnpj: z.string().optional(),
    endereco: z.string().optional(),
    pipedriveOrgId: z.string().optional(),
  })).optional(),
});

export async function postSubmitBeneficiaries(req: Request, res: Response) {
  const { token } = req.params;

  try {
    const parsed = bodySchema.parse(req.body);
    const payload = {
      none: parsed.none === 'true',
      pf: (parsed.pf ?? []).map((p) => ({ nome: p.nome ?? '', cpf: p.cpf ?? '', pipedrivePersonId: p.pipedrivePersonId })),
      pj: (parsed.pj ?? []).map((p) => ({ razaoSocial: p.razaoSocial ?? '', cnpj: p.cnpj ?? '', endereco: p.endereco, pipedriveOrgId: p.pipedriveOrgId })),
    };

    const result = await submitBeneficiaries(token, payload);
    return res.render('email-action/result', { layout: false, ...result });
  } catch (err: any) {
    return res.render('email-action/result', {
      layout: false,
      success: false,
      title: 'Erro ao confirmar',
      message: `Não foi possível registrar os beneficiários: ${err.message}`,
    });
  }
}
