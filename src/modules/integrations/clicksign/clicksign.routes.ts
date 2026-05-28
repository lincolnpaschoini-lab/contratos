import { Router } from 'express';
import { webhookRateLimit } from '../../../shared/middlewares/rate-limit.middleware';
import { handleClicksignWebhook } from './clicksign.controller';

const router = Router();

router.post('/webhook', webhookRateLimit, handleClicksignWebhook);

export { router as clicksignRoutes };
