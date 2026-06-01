import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loginUser } from './auth.service';
import { setFlash } from '../../shared/middlewares/flash.middleware';
import { env } from '../../config/env';

const loginSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(1, 'Senha obrigatória.'),
  rememberMe: z.string().optional().transform((v) => v === 'on'),
});

export async function getLogin(req: Request, res: Response) {
  if (res.locals.currentUser) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login', layout: false });
}

export async function postLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, rememberMe } = loginSchema.parse(req.body);
    const { token, cookieMaxAge } = await loginUser(email, password, rememberMe);

    res.cookie('token', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: cookieMaxAge,
    });

    const next_url = (req.query.next as string) || '/dashboard';
    res.redirect(next_url);
  } catch (err: any) {
    res.render('auth/login', {
      title: 'Login',
      layout: false,
      error: err.message || 'Erro ao fazer login.',
      email: req.body.email,
    });
  }
}

export function logout(req: Request, res: Response) {
  res.clearCookie('token');
  setFlash(res, 'success', 'Você saiu do sistema.');
  res.redirect('/auth/login');
}
