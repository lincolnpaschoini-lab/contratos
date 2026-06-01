import { Router } from 'express';
import { requireAuth } from '../../shared/middlewares/auth.middleware';
import { listNotifications, readNotification, readAllNotifications } from './notifications.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listNotifications);
router.post('/read-all', readAllNotifications);
router.post('/:id/read', readNotification);

export { router as notificationRoutes };
