import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { setFlash } from '../../shared/middlewares/flash.middleware';
import { getAllSlaRules, updateSlaRule, upsertCompanySlaRule } from './settings.service';
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

    res.render('settings/sla', { title: 'Configurações de SLA', ruleMap, companies, STEP_ORDER_LIST });
  } catch (err) {
    next(err);
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
