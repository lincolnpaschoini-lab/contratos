import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import {
  getSlaSettings, postUpdateSla, getWebhookEvents,
  postRecalculateAll, getIntegrations, postTestPipedrive, postTestClicksign,
} from './settings.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/sla', getSlaSettings);
router.post('/sla/:id', postUpdateSla);
router.post('/recalculate', postRecalculateAll);
router.get('/webhooks', getWebhookEvents);
router.get('/integrations', getIntegrations);
router.post('/integrations/test/pipedrive', postTestPipedrive);
router.post('/integrations/test/clicksign', postTestClicksign);

export { router as settingsRoutes };
