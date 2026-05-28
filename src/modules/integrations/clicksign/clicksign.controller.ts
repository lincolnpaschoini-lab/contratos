import { Request, Response, NextFunction } from 'express';
import { processClicksignWebhook, verifyClicksignToken } from './clicksign.service';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';

export async function handleClicksignWebhook(req: Request, res: Response, next: NextFunction) {
  const correlationId = res.locals.correlationId as string;

  logger.info('Webhook Clicksign recebido', {
    correlationId,
    event: req.body?.event?.name,
    documentKey: req.body?.event?.data?.document?.key,
  });

  // Validação do token de acesso da Clicksign
  const token =
    (req.headers['x-clicksign-token'] as string) ??
    (req.query.token as string);

  if (!verifyClicksignToken(token)) {
    logger.warn('Webhook Clicksign com token inválido', { correlationId });
    return res.status(401).json({ success: false, message: 'Token inválido.' });
  }

  // Responde imediatamente (a Clicksign espera 200 rápido)
  res.status(200).json({ success: true, message: 'Recebido.' });

  processClicksignWebhook(req.body, req.body).catch((err) => {
    logger.error('Erro ao processar webhook Clicksign', { correlationId, error: err.message });
  });
}
