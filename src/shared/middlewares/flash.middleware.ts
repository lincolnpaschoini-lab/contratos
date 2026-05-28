import { Request, Response, NextFunction } from 'express';
import { FlashMessage, FlashType } from '../types';

export function flashMiddleware(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.flash;
  if (raw) {
    try {
      res.locals.flash = JSON.parse(raw) as FlashMessage;
    } catch {
      res.locals.flash = null;
    }
    res.clearCookie('flash');
  } else {
    res.locals.flash = null;
  }
  next();
}

export function setFlash(res: Response, type: FlashType, message: string) {
  res.cookie('flash', JSON.stringify({ type, message }), {
    httpOnly: false,
    maxAge: 10000,
    sameSite: 'lax',
  });
}
