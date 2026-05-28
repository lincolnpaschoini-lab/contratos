import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import { getWebhookEvents, deleteWebhookEvent, deleteAllWebhookEvents } from './webhooks.controller';

const router = Router();

router.use(requireAuth, requireAdmin);
router.get('/', getWebhookEvents);
router.post('/:id/delete', deleteWebhookEvent);
router.post('/delete-all', deleteAllWebhookEvents);

export { router as webhookEventRoutes };
