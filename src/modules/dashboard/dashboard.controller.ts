import { Request, Response, NextFunction } from 'express';
import { getDashboardSummary } from './dashboard.service';

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await getDashboardSummary();

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, data: summary });
    }

    res.render('dashboard/index', { title: 'Dashboard', summary });
  } catch (err) {
    next(err);
  }
}

// Retorna apenas o card do pipeline como HTML parcial (para atualização sem reload)
export async function getPipelinePartial(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await getDashboardSummary();
    res.render('dashboard/pipeline', { layout: false, summary });
  } catch (err) {
    next(err);
  }
}

// Retorna o conteúdo completo do dashboard (métricas + pipeline) sem layout
export async function getDashboardContent(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await getDashboardSummary();
    res.render('dashboard/index', { layout: false, summary });
  } catch (err) {
    next(err);
  }
}
