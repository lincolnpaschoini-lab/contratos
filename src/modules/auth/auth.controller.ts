import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loginUser } from './auth.service';
import { setFlash } from '../../shared/middlewares/flash.middleware';
import { env } from '../../config/env';

const REMEMBER_COOKIE = 'remember_email';
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dias

const loginSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(1, 'Senha obrigatória.'),
  rememberMe: z.string().optional().transform((v) => v === 'on'),
});

export async function getLogin(req: Request, res: Response) {
  if (res.locals.currentUser) return res.redirect('/dashboard');

  // Lê o e-mail salvo pelo "Lembrar" (cookie persiste mesmo após logout)
  const savedEmail = req.cookies?.[REMEMBER_COOKIE] ?? '';

  res.render('auth/login', { title: 'Login', layout: false, savedEmail });
}

export async function postLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, rememberMe } = loginSchema.parse(req.body);
    const { token, cookieMaxAge } = await loginUser(email, password, rememberMe);

    // Cookie de sessão JWT
    res.cookie('token', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: cookieMaxAge,
    });

    if (rememberMe) {
      // Cookie de e-mail salvo — sobrevive ao logout para pré-preencher o form
      res.cookie(REMEMBER_COOKIE, email, {
        httpOnly: false,           // precisa ser legível pelo template (via req.cookies no server)
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: REMEMBER_MAX_AGE,
      });
    } else {
      // Se o usuário desmarcar "Lembrar", remove o cookie salvo
      res.clearCookie(REMEMBER_COOKIE);
    }

    const next_url = (req.query.next as string) || '/dashboard';
    res.redirect(next_url);
  } catch (err: any) {
    const savedEmail = req.cookies?.[REMEMBER_COOKIE] ?? '';
    res.render('auth/login', {
      title: 'Login',
      layout: false,
      error: err.message || 'Erro ao fazer login.',
      email: req.body.email,
      savedEmail,
    });
  }
}

export function logout(req: Request, res: Response) {
  res.clearCookie('token');
  // Mantém remember_email intencional — o usuário quer voltar facilmente
  setFlash(res, 'success', 'Você saiu do sistema.');
  res.redirect('/auth/login');
}
