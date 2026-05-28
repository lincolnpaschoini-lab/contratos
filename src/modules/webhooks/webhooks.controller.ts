import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';

export async function getWebhookEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 30;

    const where: any = {};
    if (req.query.source) where.source = req.query.source;
    if (req.query.processed !== undefined) where.processed = req.query.processed === 'true';

    const [total, events] = await Promise.all([
      prisma.webhookEvent.count({ where }),
      prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, data: events, total, page, totalPages: Math.ceil(total / limit) });
    }

    res.render('settings/webhooks', {
      title: 'Eventos de Webhook',
      events,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      filters: { source: req.query.source, processed: req.query.processed },
    });
  } catch (err) {
    next(err);
  }
}
