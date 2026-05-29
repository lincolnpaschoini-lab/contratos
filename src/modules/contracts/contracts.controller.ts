import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { setFlash } from '../../shared/middlewares/flash.middleware';
import { JwtPayload } from '../../shared/types';
import {
  listContracts,
  getContractDetail as fetchContractDetail,
  startStep,
  completeStep,
  assignStep,
  updateStepNotes,
  assignTracking,
  syncContractPipedriveData,
} from './contracts.service';
import { ContractStatus, StepName } from '@prisma/client';

// Converte string vazia para undefined antes de validar
const emptyToUndefined = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(ContractStatus).optional()),
  currentStep: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(StepName).optional()),
  delayedStep: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(StepName).optional()),
  assignedUserId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  customerId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  search: emptyToUndefined,
  dateFrom: emptyToUndefined,
  dateTo: emptyToUndefined,
});

export async function getContractsList(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listQuerySchema.parse(req.query);
    const [result, users] = await Promise.all([
      listContracts(
        {
          status: query.status,
          currentStep: query.currentStep,
          delayedStep: query.delayedStep,
          assignedUserId: query.assignedUserId,
          customerId: query.customerId,
          search: query.search,
          dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
          dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        },
        { page: query.page, limit: query.limit },
      ),
      prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
    ]);

    // Retorna JSON para chamadas AJAX
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, ...result });
    }

    res.render('contracts/list', {
      title: 'Contratos',
      ...result,
      users,
      filters: query,
      StepName,
      ContractStatus,
    });
  } catch (err) {
    next(err);
  }
}

export async function getContractDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const contract = await fetchContractDetail(req.params.id);
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });

    res.render('contracts/detail', {
      title: `Contrato — ${(contract as any).customer.name}`,
      contract,
      users,
      StepName,
    });
  } catch (err) {
    next(err);
  }
}

export async function postStartStep(req: Request, res: Response, next: NextFunction) {
  try {
    const user = res.locals.currentUser as JwtPayload;
    await startStep(req.params.id, req.params.stepId, user.sub);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Etapa iniciada.' });
    }
    setFlash(res, 'success', 'Etapa iniciada com sucesso.');
    res.redirect(`/contracts/${req.params.id}`);
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(err.statusCode ?? 400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao iniciar etapa.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}

export async function postCompleteStep(req: Request, res: Response, next: NextFunction) {
  try {
    const user = res.locals.currentUser as JwtPayload;
    const { notes } = req.body;
    await completeStep(req.params.id, req.params.stepId, user.sub, notes);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Etapa concluída.' });
    }
    setFlash(res, 'success', 'Etapa concluída com sucesso.');
    res.redirect(`/contracts/${req.params.id}`);
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(err.statusCode ?? 400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao concluir etapa.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}

export async function postAssignStep(req: Request, res: Response, next: NextFunction) {
  try {
    const user = res.locals.currentUser as JwtPayload;
    const { assignedUserId } = req.body;
    if (!assignedUserId) throw new Error('Usuário obrigatório.');
    await assignStep(req.params.id, req.params.stepId, assignedUserId, user.sub);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Responsável atribuído.' });
    }
    setFlash(res, 'success', 'Responsável atribuído.');
    res.redirect(`/contracts/${req.params.id}`);
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao atribuir responsável.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}

export async function postUpdateNotes(req: Request, res: Response, next: NextFunction) {
  try {
    const user = res.locals.currentUser as JwtPayload;
    const { notes } = req.body;
    await updateStepNotes(req.params.id, req.params.stepId, notes ?? '', user.sub);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Observação salva.' });
    }
    setFlash(res, 'success', 'Observação salva.');
    res.redirect(`/contracts/${req.params.id}`);
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao salvar observação.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}

export async function postAssignTracking(req: Request, res: Response, next: NextFunction) {
  try {
    const user = res.locals.currentUser as JwtPayload;
    const { assignedUserId } = req.body;
    if (!assignedUserId) throw new Error('Usuário obrigatório.');
    await assignTracking(req.params.id, assignedUserId, user.sub);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Responsável do contrato atribuído.' });
    }
    setFlash(res, 'success', 'Responsável atribuído ao contrato.');
    res.redirect(`/contracts/${req.params.id}`);
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao atribuir responsável.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}

export async function syncPipedriveData(req: Request, res: Response, _next: NextFunction) {
  try {
    const result = await syncContractPipedriveData(req.params.id);
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: `Dados sincronizados — ${result.org ?? 'sem org'} / ${result.person ?? 'sem pessoa'}` });
    }
    setFlash(res, 'success', `Dados do Pipedrive atualizados com sucesso.`);
    res.redirect(`/contracts/${req.params.id}`);
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(err.statusCode ?? 500).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao sincronizar dados.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}

export async function deleteContract(req: Request, res: Response, _next: NextFunction) {
  try {
    const tracking = await prisma.contractTracking.findUnique({
      where: { id: req.params.id },
      include: { pipedriveDeal: true },
    });

    if (!tracking) {
      setFlash(res, 'error', 'Contrato não encontrado.');
      return res.redirect('/contracts');
    }

    const { customerId } = tracking;
    const dealDbId = tracking.pipedriveDeal.id;
    const externalDealId = tracking.pipedriveDeal.externalDealId;

    await prisma.contractTracking.delete({ where: { id: req.params.id } });
    await prisma.pipedriveDeal.delete({ where: { id: dealDbId } });

    if (customerId.startsWith('ext-')) {
      await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    }

    setFlash(res, 'success', `Contrato excluído. (Deal: ${externalDealId})`);
    res.redirect('/contracts');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao excluir contrato.');
    res.redirect(`/contracts/${req.params.id}`);
  }
}
