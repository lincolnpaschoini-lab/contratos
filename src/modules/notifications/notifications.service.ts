import { prisma } from '../../config/database';
import { broadcastEvent } from '../../shared/events/sse.service';
import { logger } from '../../config/logger';

export async function getUnreadCount(): Promise<number> {
  return prisma.notification.count({ where: { readAt: null } });
}

export async function createNotification(data: {
  type: string;
  title: string;
  body?: string;
  trackingId?: string | null;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        trackingId: data.trackingId ?? null,
      },
    });

    const unreadCount = await getUnreadCount();
    broadcastEvent('notification', { unreadCount });
  } catch (err: any) {
    logger.error(`[NOTIF] Falha ao criar notificação: ${err.message}`);
  }
}

export async function getNotifications(limit = 50) {
  return prisma.notification.findMany({
    take: limit,
    orderBy: [
      { readAt: { sort: 'asc', nulls: 'first' } },
      { createdAt: 'desc' },
    ],
    include: {
      contractTracking: {
        include: { customer: { select: { name: true } } },
      },
    },
  });
}

export async function markAsRead(id: string): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllAsRead(): Promise<void> {
  await prisma.notification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
}
