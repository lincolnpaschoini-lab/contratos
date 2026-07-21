import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import {
  getContractsList,
  getContractDetail,
  postStartStep,
  postCompleteStep,
  postAssignStep,
  postUpdateNotes,
  postAssignTracking,
  deleteContract,
  syncPipedriveData,
  refreshClicksign,
  postSendToClicksign,
  getClicksignStatus,
  getContractStepStatus,
  postSendRegistrationEmail,
  postResendBeneficiariesEmail,
} from './contracts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getContractsList);
router.get('/:id', getContractDetail);
router.get('/:id/clicksign-status', getClicksignStatus);
router.get('/:id/step-status', getContractStepStatus);

// Ações que mudam estado do contrato — restritas a ADMIN (Operador só visualiza)
router.post('/:id/assign', requireAdmin, postAssignTracking);
router.post('/:id/steps/:stepId/start', requireAdmin, postStartStep);
router.post('/:id/steps/:stepId/complete', requireAdmin, postCompleteStep);
router.post('/:id/steps/:stepId/assign', requireAdmin, postAssignStep);
router.post('/:id/steps/:stepId/notes', requireAdmin, postUpdateNotes);
router.post('/:id/delete', requireAdmin, deleteContract);
router.post('/:id/sync-pipedrive', requireAdmin, syncPipedriveData);
router.post('/:id/clicksign-refresh', requireAdmin, refreshClicksign);
router.post('/:id/clicksign-send', requireAdmin, postSendToClicksign);
router.post('/:id/send-registration-email', requireAdmin, postSendRegistrationEmail);
router.post('/:id/resend-beneficiaries-email', requireAdmin, postResendBeneficiariesEmail);

export { router as contractRoutes };
