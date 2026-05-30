import { Request, Response } from 'express';
import { StepStatus, StepName } from '@prisma/client';
import { prisma } from '../../config/database';
import { completeStep } from '../contracts/contracts.service';
import { logger } from '../../config/logger';

export async function getRegistrationAction(req: Request, res: Response) {
  const { token } = req.params;

  const renderResult = (opts: {
    success: boolean;
    title: string;
    message: string;
    customerName?: string;
  }) => res.render('email-action/result', { layout: false, ...opts });

  const actionToken = await prisma.actionToken.findUnique({
    where: { token },
    include: {
      contractTracking: {
        include: {
          customer: true,
          steps: true,
        },
      },
    },
  });

  if (!actionToken) {
    return renderResult({ success: false, title: 'Link inválido', message: 'Este link é inválido ou não existe.' });
  }

  if (actionToken.usedAt) {
    return renderResult({
      success: true,
      title: 'Já confirmado',
      message: `O cadastro do contrato de ${actionToken.contractTracking.customer.name} já foi confirmado anteriormente.`,
      customerName: actionToken.contractTracking.customer.name,
    });
  }

  if (new Date() > actionToken.expiresAt) {
    return renderResult({ success: false, title: 'Link expirado', message: 'Este link expirou. Entre em contato com a equipe interna para reenvio.' });
  }

  const tracking = actionToken.contractTracking;
  const regStep = tracking.steps.find((s) => s.stepName === StepName.CONTRACT_REGISTRATION);

  if (!regStep) {
    return renderResult({ success: false, title: 'Etapa não encontrada', message: 'Não foi possível localizar a etapa de cadastro neste contrato.' });
  }

  if (regStep.status === StepStatus.COMPLETED) {
    await prisma.actionToken.update({ where: { id: actionToken.id }, data: { usedAt: new Date() } });
    return renderResult({
      success: true,
      title: 'Cadastro já confirmado',
      message: `O contrato de ${tracking.customer.name} já estava na etapa de Faturamento.`,
      customerName: tracking.customer.name,
    });
  }

  if (regStep.status === StepStatus.PENDING) {
    return renderResult({
      success: false,
      title: 'Contrato ainda não está em Cadastro',
      message: 'A etapa de Cadastro do Contrato ainda não foi iniciada. Tente novamente em alguns instantes.',
    });
  }

  try {
    await completeStep(
      tracking.id,
      regStep.id,
      'system-email',
      'Cadastro confirmado via e-mail',
      { source: 'email-action', token },
    );

    await prisma.actionToken.update({ where: { id: actionToken.id }, data: { usedAt: new Date() } });

    logger.info(`[EMAIL ACTION] Cadastro confirmado: tracking ${tracking.id} via token ${token}`);

    return renderResult({
      success: true,
      title: 'Cadastro confirmado!',
      message: `O contrato de ${tracking.customer.name} foi avançado para Faturamento com sucesso.`,
      customerName: tracking.customer.name,
    });
  } catch (err: any) {
    logger.error(`[EMAIL ACTION] Erro ao confirmar cadastro: ${err.message}`);
    return renderResult({
      success: false,
      title: 'Erro ao confirmar',
      message: `Não foi possível confirmar o cadastro: ${err.message}`,
    });
  }
}
