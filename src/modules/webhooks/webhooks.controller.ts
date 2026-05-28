import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { setFlash } from '../../shared/middlewares/flash.middleware';

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

export async function deleteWebhookEvent(req: Request, res: Response, _next: NextFunction) {
  try {
    await prisma.webhookEvent.delete({ where: { id: req.params.id } });
    setFlash(res, 'success', 'Evento excluído.');
  } catch {
    setFlash(res, 'error', 'Erro ao excluir evento.');
  }
  res.redirect('/settings/webhooks');
}

export async function deleteAllWebhookEvents(req: Request, res: Response, _next: NextFunction) {
  try {
    const { source } = req.body;
    const where = source ? { source } : {};
    const { count } = await prisma.webhookEvent.deleteMany({ where });
    setFlash(res, 'success', `${count} evento(s) excluído(s).`);
  } catch {
    setFlash(res, 'error', 'Erro ao excluir eventos.');
  }
  res.redirect('/settings/webhooks');
}
