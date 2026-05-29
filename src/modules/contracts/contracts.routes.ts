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
} from './contracts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getContractsList);
router.get('/:id', getContractDetail);
router.post('/:id/assign', postAssignTracking);
router.post('/:id/steps/:stepId/start', postStartStep);
router.post('/:id/steps/:stepId/complete', postCompleteStep);
router.post('/:id/steps/:stepId/assign', postAssignStep);
router.post('/:id/steps/:stepId/notes', postUpdateNotes);
router.post('/:id/delete', requireAdmin, deleteContract);
router.post('/:id/sync-pipedrive', requireAdmin, syncPipedriveData);
router.post('/:id/clicksign-refresh', refreshClicksign);

export { router as contractRoutes };
