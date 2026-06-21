import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import {
  getSlaSettings, postUpdateSla, postUpsertCompanySla, postResetCompanySla, getWebhookEvents,
  postRecalculateAll, getIntegrations, postTestPipedrive, postTestClicksign,
  getPlaceholderSettings, postCreateMapping, postUpdateMapping, postDeleteMapping, postToggleMapping,
} from './settings.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/sla', getSlaSettings);
router.post('/sla/step/:stepName', postUpsertCompanySla);
router.post('/sla/step/:stepName/reset', postResetCompanySla);
router.post('/sla/:id', postUpdateSla);
router.post('/recalculate', postRecalculateAll);
router.get('/webhooks', getWebhookEvents);
router.get('/integrations', getIntegrations);
router.post('/integrations/test/pipedrive', postTestPipedrive);
router.post('/integrations/test/clicksign', postTestClicksign);

router.get('/placeholders', getPlaceholderSettings);
router.post('/placeholders', postCreateMapping);
router.post('/placeholders/:id', postUpdateMapping);
router.post('/placeholders/:id/toggle', postToggleMapping);
router.post('/placeholders/:id/delete', postDeleteMapping);

export { router as settingsRoutes };
