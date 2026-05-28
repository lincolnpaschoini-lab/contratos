import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../shared/middlewares/auth.middleware';
import { getUsersList, postCreateUser, postUpdateUser, postResetPassword } from './users.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', getUsersList);
router.post('/', postCreateUser);
router.post('/:id', postUpdateUser);
router.post('/:id/reset-password', postResetPassword);

export { router as userRoutes };
