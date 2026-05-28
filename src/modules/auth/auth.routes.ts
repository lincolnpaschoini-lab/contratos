import { Router } from 'express';
import { getLogin, postLogin, logout } from './auth.controller';
import { loginRateLimit } from '../../shared/middlewares/rate-limit.middleware';

const router = Router();

router.get('/login', getLogin);
router.post('/login', loginRateLimit, postLogin);
router.post('/logout', logout);
router.get('/logout', logout);

export { router as authRoutes };
