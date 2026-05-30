import { Router } from 'express';
import { getRegistrationAction } from './email-action.controller';

const router = Router();

router.get('/cadastro/:token', getRegistrationAction);

export { router as emailActionRoutes };
