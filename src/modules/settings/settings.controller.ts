import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { setFlash } from '../../shared/middlewares/flash.middleware';
import {
  getAllSlaRules, updateSlaRule, upsertCompanySlaRule, deleteCompanySlaRule, setSlaStepMode,
  getBeneficiaryNotifyRules, upsertGlobalBeneficiaryNotify, upsertCompanyBeneficiaryNotify, deleteCompanyBeneficiaryNotify, setBeneficiaryMode,
} from './settings.service';
import {
  getAllMappings, createMapping, updateMapping, deleteMapping, toggleMappingActive,
  SOURCE_FIELDS, CONTRACT_TYPE_LABELS, resolveSourceField,
} from './placeholder.service';
import { StepName } from '@prisma/client';
import { prisma } from '../../config/database';
import { recalculateAllDelays } from '../contracts/contracts.service';
import { processPipedriveWebhook } from '../integrations/pipedrive/pipedrive.service';
import { processClicksignWebhook } from '../integrations/clicksign/clicksign.service';
import { env } from '../../config/env';

const STEP_ORDER_LIST: StepName[] = [
  StepName.PROPOSAL_ACCEPTED,
  StepName.CONTRACT_PREPARATION,
  StepName.CONTRACT_SIGNING,
  StepName.CONTRACT_REGISTRATION,
  StepName.CONTRACT_BILLING,
];

export async function getSlaSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const rules = await getAllSlaRules();

    const companies = [
      { name: 'Paschoini', companyId: env.PIPEDRIVE_PASCHOINI_COMPANY_ID },
      { name: 'Focus',     companyId: env.PIPEDRIVE_FOCUS_COMPANY_ID },
      { name: 'Attivos',   companyId: env.PIPEDRIVE_ATTIVOS_COMPANY_ID },
    ].filter((c): c is { name: string; companyId: string } => !!c.companyId);

    // Organiza: { [stepName]: { global: SlaRule | null; byCompany: { [companyId]: SlaRule } } }
    const ruleMap: Record<string, { global: any; byCompany: Record<string, any> }> = {};
    for (const step of STEP_ORDER_LIST) {
      ruleMap[step] = { global: null, byCompany: {} };
    }
    for (const rule of rules) {
      if (rule.companyId === null) {
        ruleMap[rule.stepName].global = rule;
      } else {
        ruleMap[rule.stepName].byCompany[rule.companyId] = rule;
      }
    }

    const delayNotifyEmailsEnv = (env.DELAY_NOTIFY_EMAILS ?? '')
      .split(',').map((e) => e.trim()).filter(Boolean).join('\n');

    // Regras de notificação de definição de beneficiários — mesma forma global + override por empresa
    const beneficiaryRules = await getBeneficiaryNotifyRules();
    const beneficiaryRuleMap: { global: any; byCompany: Record<string, any> } = { global: null, byCompany: {} };
    for (const rule of beneficiaryRules) {
      if (rule.companyId === null) {
        beneficiaryRuleMap.global = rule;
      } else {
        beneficiaryRuleMap.byCompany[rule.companyId] = rule;
      }
    }

    res.render('settings/sla', { title: 'Configurações de SLA', ruleMap, companies, STEP_ORDER_LIST, delayNotifyEmailsEnv, beneficiaryRuleMap });
  } catch (err) {
    next(err);
  }
}

// ─── Config. Notificação de Beneficiários ────────────────────────────────────

export async function postUpdateBeneficiaryGlobal(req: Request, res: Response, next: NextFunction) {
  try {
    const { active, notifyEmails } = z
      .object({
        active: z.string().optional().transform((v) => v !== 'false'),
        notifyEmails: z.string().optional().transform((v) => {
          if (!v) return null;
          const emails = v.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);
          return emails.length > 0 ? emails.join(',') : null;
        }),
      })
      .parse(req.body);

    await upsertGlobalBeneficiaryNotify(notifyEmails, active);
    setFlash(res, 'success', 'Notificação de beneficiários (global) salva com sucesso.');
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao salvar notificação de beneficiários.');
    res.redirect('/settings/sla');
  }
}

export async function postUpsertBeneficiaryCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const { companyId, active, notifyEmails } = z
      .object({
        companyId: z.string().min(1, 'Empresa obrigatória.'),
        active: z.string().optional().transform((v) => v !== 'false'),
        notifyEmails: z.string().optional().transform((v) => {
          if (!v) return null;
          const emails = v.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);
          return emails.length > 0 ? emails.join(',') : null;
        }),
      })
      .parse(req.body);

    await upsertCompanyBeneficiaryNotify(companyId, notifyEmails, active);
    setFlash(res, 'success', 'Override de notificação de beneficiários salvo com sucesso.');
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao salvar override de notificação de beneficiários.');
    res.redirect('/settings/sla');
  }
}

export async function postSetBeneficiaryMode(req: Request, res: Response, next: NextFunction) {
  try {
    const { mode } = z.object({ mode: z.enum(['GLOBAL', 'INDIVIDUAL']) }).parse(req.body);
    await setBeneficiaryMode(mode);
    setFlash(res, 'success', `Modo de configuração de beneficiários atualizado para ${mode === 'GLOBAL' ? 'Global' : 'Individual por empresa'}.`);
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao atualizar modo de configuração.');
    res.redirect('/settings/sla');
  }
}

export async function postResetBeneficiaryCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(req.body);
    await deleteCompanyBeneficiaryNotify(companyId);
    setFlash(res, 'success', 'Override removido. A empresa voltará a usar a regra Global.');
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao resetar configuração.');
    res.redirect('/settings/sla');
  }
}

export async function postRecalculateAll(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await recalculateAllDelays();
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: `Reconciliação concluída. ${result.processed} contrato(s) processados.`, data: result });
    }
    setFlash(res, 'success', `Reconciliação concluída: ${result.processed} contrato(s) processados, ${result.updated} etapa(s) corrigidas.`);
    res.redirect('/settings/sla');
  } catch (err) {
    next(err);
  }
}

export async function postUpdateSla(req: Request, res: Response, next: NextFunction) {
  try {
    const { businessDays, active, notifyEmails, notifyOnNewLead } = z
      .object({
        businessDays: z.coerce.number().min(0).max(30),
        active: z.string().optional().transform((v) => v !== 'false'),
        notifyEmails: z.string().optional().transform((v) => {
          if (!v) return null;
          // normaliza: uma por linha ou separadas por vírgula → armazena como CSV
          const emails = v.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);
          return emails.length > 0 ? emails.join(',') : null;
        }),
        notifyOnNewLead: z.string().optional().transform((v) => v === 'true'),
      })
      .parse(req.body);

    const rule = await updateSlaRule(req.params.id, businessDays, active, notifyEmails, notifyOnNewLead);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, data: rule });
    }
    setFlash(res, 'success', 'SLA atualizado com sucesso.');
    res.redirect('/settings/sla');
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao atualizar SLA.');
    res.redirect('/settings/sla');
  }
}

export async function postUpsertCompanySla(req: Request, res: Response, next: NextFunction) {
  try {
    const stepName = req.params.stepName as StepName;
    if (!STEP_ORDER_LIST.includes(stepName)) {
      throw new Error('Etapa inválida.');
    }

    const { companyId, businessDays, active, notifyEmails, notifyOnNewLead } = z
      .object({
        companyId: z.string().min(1, 'Empresa obrigatória.'),
        businessDays: z.coerce.number().min(0).max(30),
        active: z.string().optional().transform((v) => v !== 'false'),
        notifyEmails: z.string().optional().transform((v) => {
          if (!v) return null;
          const emails = v.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);
          return emails.length > 0 ? emails.join(',') : null;
        }),
        notifyOnNewLead: z.string().optional().transform((v) => v === 'true'),
      })
      .parse(req.body);

    await upsertCompanySlaRule(stepName, companyId, { businessDays, active, notifyEmails, notifyOnNewLead });

    setFlash(res, 'success', 'Configuração por empresa salva com sucesso.');
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao salvar configuração por empresa.');
    res.redirect('/settings/sla');
  }
}

export async function postSetSlaMode(req: Request, res: Response, next: NextFunction) {
  try {
    const stepName = req.params.stepName as StepName;
    if (!STEP_ORDER_LIST.includes(stepName)) {
      throw new Error('Etapa inválida.');
    }
    const { mode } = z.object({ mode: z.enum(['GLOBAL', 'INDIVIDUAL']) }).parse(req.body);
    await setSlaStepMode(stepName, mode);
    setFlash(res, 'success', `Modo de configuração atualizado para ${mode === 'GLOBAL' ? 'Global' : 'Individual por empresa'}.`);
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao atualizar modo de configuração.');
    res.redirect('/settings/sla');
  }
}

export async function postResetCompanySla(req: Request, res: Response, next: NextFunction) {
  try {
    const stepName = req.params.stepName as StepName;
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(req.body);
    await deleteCompanySlaRule(stepName, companyId);
    setFlash(res, 'success', 'Override removido. A etapa voltará a usar a regra Global.');
    res.redirect('/settings/sla');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao resetar configuração.');
    res.redirect('/settings/sla');
  }
}

// ─── Config. Placeholders ────────────────────────────────────────────────────

export async function getPlaceholderSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const [mappings, latestTracking] = await Promise.all([
      getAllMappings(),
      prisma.contractTracking.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { customer: true, pipedriveDeal: true },
      }),
    ]);

    const exampleValues: Record<string, string> = {};
    if (latestTracking) {
      for (const sf of SOURCE_FIELDS) {
        exampleValues[sf.field] = resolveSourceField(sf.field, latestTracking.customer, latestTracking.pipedriveDeal) || '';
      }
    }

    res.render('settings/placeholders', {
      title: 'Config. Placeholders',
      mappings,
      SOURCE_FIELDS,
      CONTRACT_TYPE_LABELS,
      exampleValues,
      exampleCustomerName: (latestTracking?.customer as any)?.name ?? null,
    });
  } catch (err) {
    next(err);
  }
}

export async function postCreateMapping(req: Request, res: Response, next: NextFunction) {
  try {
    const data = z.object({
      sourceField:          z.string().min(1, 'Campo fonte obrigatório.'),
      clicksignPlaceholder: z.string().min(1, 'Placeholder obrigatório.'),
      contractType:         z.enum(['all', 'PF', 'PJ']),
    }).parse(req.body);

    await createMapping(data);
    setFlash(res, 'success', 'Mapeamento adicionado com sucesso.');
    res.redirect('/settings/placeholders');
  } catch (err: any) {
    if (err.code === 'P2002') {
      setFlash(res, 'error', 'Já existe um mapeamento com esse campo, placeholder e tipo.');
    } else {
      setFlash(res, 'error', err.message ?? 'Erro ao criar mapeamento.');
    }
    res.redirect('/settings/placeholders');
  }
}

export async function postUpdateMapping(req: Request, res: Response, next: NextFunction) {
  try {
    const data = z.object({
      sourceField:          z.string().min(1, 'Campo fonte obrigatório.'),
      clicksignPlaceholder: z.string().min(1, 'Placeholder obrigatório.'),
      contractType:         z.enum(['all', 'PF', 'PJ']),
    }).parse(req.body);

    await updateMapping(req.params.id, data);
    setFlash(res, 'success', 'Mapeamento atualizado com sucesso.');
    res.redirect('/settings/placeholders');
  } catch (err: any) {
    if (err.code === 'P2002') {
      setFlash(res, 'error', 'Já existe um mapeamento com esse campo, placeholder e tipo.');
    } else {
      setFlash(res, 'error', err.message ?? 'Erro ao atualizar mapeamento.');
    }
    res.redirect('/settings/placeholders');
  }
}

export async function postDeleteMapping(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteMapping(req.params.id);
    setFlash(res, 'success', 'Mapeamento removido.');
    res.redirect('/settings/placeholders');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao remover mapeamento.');
    res.redirect('/settings/placeholders');
  }
}

export async function postToggleMapping(req: Request, res: Response, next: NextFunction) {
  try {
    await toggleMappingActive(req.params.id);
    res.redirect('/settings/placeholders');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao alterar status.');
    res.redirect('/settings/placeholders');
  }
}

export async function getWebhookEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 30;
    const source = req.query.source as string | undefined;
    const processed = req.query.processed !== undefined
      ? req.query.processed === 'true'
      : undefined;

    const where: any = {};
    if (source) where.source = source;
    if (processed !== undefined) where.processed = processed;

    const [total, events] = await Promise.all([
      prisma.webhookEvent.count({ where }),
      prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.render('settings/webhooks', {
      title: 'Eventos de Webhook',
      events,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      filters: { source, processed },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Diagnóstico de integrações ───────────────────────────────────────────────

export async function getIntegrations(req: Request, res: Response, next: NextFunction) {
  try {
    const [pipedriveEvents, clicksignEvents, contractsForClicksign] = await Promise.all([
      prisma.webhookEvent.findMany({
        where: { source: 'pipedrive' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.webhookEvent.findMany({
        where: { source: 'clicksign' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Contratos na etapa de assinatura para o teste de Clicksign
      prisma.contractTracking.findMany({
        where: {
          steps: { some: { stepName: 'CONTRACT_SIGNING', status: { in: ['IN_PROGRESS', 'DELAYED'] } } },
        },
        include: {
          customer: { select: { name: true } },
          clicksignDocs: { select: { id: true, externalDocumentId: true, status: true }, take: 1 },
        },
        take: 10,
      }),
    ]);

    const config = {
      pipedrive: {
        stageId: env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID || null,
        hasApiToken: !!env.PIPEDRIVE_API_TOKEN && env.PIPEDRIVE_API_TOKEN !== 'seu_token_aqui',
        hasWebhookSecret: !!env.PIPEDRIVE_WEBHOOK_SECRET && env.PIPEDRIVE_WEBHOOK_SECRET !== 'segredo_webhook_pipedrive',
        webhookUrl: `${env.APP_URL}/integrations/pipedrive/webhook`,
      },
      clicksign: {
        hasApiKey: !!env.CLICKSIGN_API_KEY && env.CLICKSIGN_API_KEY !== 'sua_chave_api_aqui',
        hasWebhookToken: !!env.CLICKSIGN_WEBHOOK_TOKEN && env.CLICKSIGN_WEBHOOK_TOKEN !== 'segredo_webhook_clicksign',
        apiUrl: env.CLICKSIGN_API_URL,
        webhookUrl: `${env.APP_URL}/integrations/clicksign/webhook`,
      },
    };

    res.render('settings/integrations', {
      title: 'Diagnóstico de Integrações',
      config,
      pipedriveEvents,
      clicksignEvents,
      contractsForClicksign,
    });
  } catch (err) {
    next(err);
  }
}

export async function postTestPipedrive(req: Request, res: Response, next: NextFunction) {
  try {
    const ts = Date.now();
    const testDealId = `TEST-${ts}`;

    const payload = {
      event: 'updated.deal',
      meta: { id: ts, action: 'updated', object: 'deal' },
      current: {
        id: ts,
        title: `[TESTE] Contrato de Exemplo — ${new Date().toLocaleString('pt-BR')}`,
        value: 10000,
        currency: 'BRL',
        stage_id: env.PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID || '1',
        stage_name: 'Proposta aceita',
        org_name: '[TESTE] Empresa de Exemplo Ltda',
        person_name: 'Contato Teste',
      },
      previous: {
        stage_id: '99',
        stage_name: 'Negociação',
      },
    };

    const result = await processPipedriveWebhook(payload as any, payload);

    return res.json({
      success: true,
      message: result.skipped
        ? `Webhook processado mas ignorado: ${result.reason}`
        : 'Contrato de teste criado com sucesso!',
      data: result,
      payload,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function postTestClicksign(req: Request, res: Response, next: NextFunction) {
  try {
    const { documentKey, trackingId } = z.object({
      documentKey: z.string().min(1, 'Chave do documento obrigatória.'),
      trackingId: z.string().uuid('ID do contrato inválido.').optional(),
    }).parse(req.body);

    // Se informou o trackingId, cria/atualiza o registro de documento para o teste
    if (trackingId) {
      await prisma.clicksignDocument.upsert({
        where: { externalDocumentId: documentKey },
        update: { status: 'pending', signedAt: null },
        create: {
          contractTrackingId: trackingId,
          externalDocumentId: documentKey,
          status: 'pending',
          sentAt: new Date(),
        },
      });
    }

    const payload = {
      event: {
        name: 'all_signed',
        data: {
          document: {
            key: documentKey,
            status: 'signed',
            filename: 'contrato-teste.pdf',
          },
        },
      },
    };

    const result = await processClicksignWebhook(payload as any, payload);

    return res.json({
      success: true,
      message: result.skipped
        ? `Webhook processado mas ignorado: ${result.reason}`
        : 'Assinatura processada com sucesso!',
      data: result,
      payload,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
