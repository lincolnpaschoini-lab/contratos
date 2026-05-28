import { Request, Response, NextFunction } from 'express';
import { processPipedriveWebhook, verifyPipedriveSignature } from './pipedrive.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import { prisma } from '../../../config/database';

export async function handlePipedriveWebhook(req: Request, res: Response, next: NextFunction) {
  const correlationId = res.locals.correlationId as string;
  const body = req.body ?? {};

  // Log completo do payload recebido para diagnóstico
  logger.info('Webhook Pipedrive recebido', {
    correlationId,
    event: body.event,
    dealId: body.current?.id,
    stageId: body.current?.stage_id,
    stageName: body.current?.stage_name,
  });
  console.log('[PIPEDRIVE WEBHOOK]', JSON.stringify({ event: body.event, stageId: body.current?.stage_id, dealId: body.current?.id }));

  // Validação de assinatura se configurada
  if (env.PIPEDRIVE_WEBHOOK_SECRET) {
    const signature = req.headers['x-pipedrive-signature'] as string;
    if (!signature || !verifyPipedriveSignature(JSON.stringify(body), signature)) {
      logger.warn('Webhook Pipedrive com assinatura inválida ou ausente', { correlationId });
      return res.status(401).json({ success: false, message: 'Assinatura inválida.' });
    }
  }

  // Salva o evento RAW no banco ANTES de responder — garante registro independente do processamento
  let webhookEventId: string | null = null;
  try {
    const eventType = body.event ?? body.meta?.action ?? 'unknown';
    const externalEventId = `pipedrive-${body.meta?.id ?? body.current?.id ?? Date.now()}-${eventType}`;

    const saved = await prisma.webhookEvent.create({
      data: {
        source: 'pipedrive',
        externalEventId,
        eventType,
        payload: body,
        processed: false,
      },
    });
    webhookEventId = saved.id;
    logger.info(`Webhook Pipedrive salvo: ${saved.id}`, { correlationId });
  } catch (err: any) {
    // Se falhar ao salvar, ainda responde 200 (não punir o Pipedrive por erro interno)
    logger.error('Falha ao salvar webhook Pipedrive no banco', { correlationId, error: err.message });
    console.error('[PIPEDRIVE WEBHOOK] Erro ao salvar no banco:', err.message);
  }

  // Responde imediatamente — Pipedrive não espera processamento
  res.status(200).json({ success: true, message: 'Recebido.' });

  // Processa em background atualizando o registro existente
  processPipedriveWebhook(body, body, webhookEventId).catch((err) => {
    logger.error('Erro ao processar webhook Pipedrive', { correlationId, error: err.message });
    console.error('[PIPEDRIVE WEBHOOK] Erro no processamento:', err.message);
  });
}
