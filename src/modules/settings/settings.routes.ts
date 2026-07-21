import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import {
  getSlaSettings, postUpdateSla, postUpsertCompanySla, postResetCompanySla, postSetSlaMode, getWebhookEvents,
  postRecalculateAll, getIntegrations, postTestPipedrive, postTestClicksign,
  getPlaceholderSettings, postCreateMapping, postUpdateMapping, postDeleteMapping, postToggleMapping,
  postUpdateBeneficiaryGlobal, postUpsertBeneficiaryCompany, postResetBeneficiaryCompany, postSetBeneficiaryMode,
} from './settings.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/sla', getSlaSettings);
router.post('/sla/step/:stepName', postUpsertCompanySla);
router.post('/sla/step/:stepName/reset', postResetCompanySla);
router.post('/sla/step/:stepName/mode', postSetSlaMode);
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

router.post('/beneficiarios', postUpdateBeneficiaryGlobal);
router.post('/beneficiarios/company', postUpsertBeneficiaryCompany);
router.post('/beneficiarios/company/reset', postResetBeneficiaryCompany);
router.post('/beneficiarios/mode', postSetBeneficiaryMode);

export { router as settingsRoutes };
