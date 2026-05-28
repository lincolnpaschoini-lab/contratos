import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import { getWebhookEvents } from './webhooks.controller';

const router = Router();

router.use(requireAuth, requireAdmin);
router.get('/', getWebhookEvents);

export { router as webhookEventRoutes };
