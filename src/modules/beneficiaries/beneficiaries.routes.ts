import { Router } from 'express';
import { getBeneficiaryForm, getPipedriveSearch, getPipedriveSelect, postSubmitBeneficiaries } from './beneficiaries.controller';

const router = Router();

router.get('/beneficiarios/:token', getBeneficiaryForm);
router.get('/beneficiarios/:token/search', getPipedriveSearch);
router.get('/beneficiarios/:token/select', getPipedriveSelect);
router.post('/beneficiarios/:token', postSubmitBeneficiaries);

export { router as beneficiariesRoutes };
