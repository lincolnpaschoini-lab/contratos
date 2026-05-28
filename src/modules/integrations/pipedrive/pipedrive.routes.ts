import { Router } from 'express';
import { webhookRateLimit } from '../../../shared/middlewares/rate-limit.middleware';
import { handlePipedriveWebhook } from './pipedrive.controller';

const router = Router();

router.post('/webhook', webhookRateLimit, handlePipedriveWebhook);

export { router as pipedriveRoutes };
