import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { JwtPayload } from '../types';
import { logger } from '../../config/logger';

function extractToken(req: Request): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// Adiciona o usuário ao res.locals se o cookie for válido (não bloqueia)
export function authContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      res.locals.currentUser = payload;
    }
  }
  next();
}

// Exige autenticação — redireciona para login se não autenticado
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (res.locals.currentUser) return next();

  if (isApiRequest(req)) {
    return res.status(401).json({ success: false, message: 'Não autenticado.' });
  }

  res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Exige papel de admin
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = res.locals.currentUser as JwtPayload | undefined;
  if (!user) {
    if (isApiRequest(req)) return res.status(401).json({ success: false, message: 'Não autenticado.' });
    return res.redirect('/auth/login');
  }

  if (user.role !== 'ADMIN') {
    logger.warn(`Acesso negado para usuário ${user.email} em ${req.path}`);
    if (isApiRequest(req)) return res.status(403).json({ success: false, message: 'Acesso negado.' });
    return res.status(403).render('errors/403', { title: 'Acesso Negado', layout: 'layouts/main' });
  }

  next();
}

function isApiRequest(req: Request): boolean {
  return req.path.startsWith('/api') || req.headers.accept?.includes('application/json') === true;
}

// Utilitário: assina um JWT para o usuário
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}
