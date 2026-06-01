import { Request, Response } from 'express';
import { getNotifications, markAsRead, markAllAsRead, getUnreadCount } from './notifications.service';

export async function listNotifications(req: Request, res: Response) {
  const notifications = await getNotifications(50);
  const unreadCount   = await getUnreadCount();
  res.json({ notifications, unreadCount });
}

export async function readNotification(req: Request, res: Response) {
  await markAsRead(req.params.id);
  res.json({ success: true });
}

export async function readAllNotifications(req: Request, res: Response) {
  await markAllAsRead();
  res.json({ success: true });
}

export async function countNotifications(req: Request, res: Response) {
  const unreadCount = await getUnreadCount();
  res.json({ unreadCount });
}
