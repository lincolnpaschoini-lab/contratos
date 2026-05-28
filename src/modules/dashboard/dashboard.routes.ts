import { Router } from 'express';
import { requireAuth } from '../../shared/middlewares/auth.middleware';
import { getDashboard } from './dashboard.controller';

const router = Router();

router.use(requireAuth);
router.get('/', getDashboard);

export { router as dashboardRoutes };
