import { Request, Response, NextFunction } from 'express';
import { processPipedriveWebhook, verifyPipedriveSignature } from './pipedrive.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';

export async function handlePipedriveWebhook(req: Request, res: Response, next: NextFunction) {
  const correlationId = res.locals.correlationId as string;

  logger.info('Webhook Pipedrive recebido', {
    correlationId,
    event: req.body?.event,
    dealId: req.body?.current?.id,
  });

  // Validação de assinatura se configurada
  if (env.PIPEDRIVE_WEBHOOK_SECRET) {
    const signature = req.headers['x-pipedrive-signature'] as string;
    if (!signature) {
      logger.warn('Webhook Pipedrive sem assinatura', { correlationId });
      return res.status(401).json({ success: false, message: 'Assinatura ausente.' });
    }

    const rawBody = JSON.stringify(req.body);
    if (!verifyPipedriveSignature(rawBody, signature)) {
      logger.warn('Webhook Pipedrive com assinatura inválida', { correlationId });
      return res.status(401).json({ success: false, message: 'Assinatura inválida.' });
    }
  }

  // Responde imediatamente para o Pipedrive (processamento assíncrono seria ideal em prod)
  res.status(200).json({ success: true, message: 'Recebido.' });

  // Processa em background (não bloqueia a resposta)
  processPipedriveWebhook(req.body, req.body).catch((err) => {
    logger.error('Erro ao processar webhook Pipedrive', { correlationId, error: err.message });
  });
}
