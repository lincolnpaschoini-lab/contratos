import { Router } from 'express';
import { requireAuth } from '../../shared/middlewares/auth.middleware';
import { getDashboard, getPipelinePartial } from './dashboard.controller';

const router = Router();

router.use(requireAuth);
router.get('/', getDashboard);
router.get('/pipeline', getPipelinePartial);

export { router as dashboardRoutes };
