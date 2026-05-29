import { Router } from 'express';
import { requireAuth } from '../../shared/middlewares/auth.middleware';
import { getDashboard, getPipelinePartial, getDashboardContent } from './dashboard.controller';

const router = Router();

router.use(requireAuth);
router.get('/', getDashboard);
router.get('/pipeline', getPipelinePartial);
router.get('/content', getDashboardContent);

export { router as dashboardRoutes };
