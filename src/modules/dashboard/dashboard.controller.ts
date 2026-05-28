import { Request, Response, NextFunction } from 'express';
import { getDashboardSummary } from './dashboard.service';

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await getDashboardSummary();

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, data: summary });
    }

    res.render('dashboard/index', {
      title: 'Dashboard',
      summary,
    });
  } catch (err) {
    next(err);
  }
}
