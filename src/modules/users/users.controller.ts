import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { setFlash } from '../../shared/middlewares/flash.middleware';
import { JwtPayload } from '../../shared/types';
import { listUsers, createUser, updateUser, resetPassword } from './users.service';

const createSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório.'),
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(6, 'Senha mínima de 6 caracteres.'),
  role: z.nativeEnum(UserRole),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.nativeEnum(UserRole).optional(),
  active: z.string().optional().transform((v) => v === 'true'),
});

export async function getUsersList(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await listUsers();
    res.render('users/index', { title: 'Usuários', users, UserRole });
  } catch (err) {
    next(err);
  }
}

export async function postCreateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createSchema.parse(req.body);
    await createUser(data);
    setFlash(res, 'success', 'Usuário criado com sucesso.');
    res.redirect('/users');
  } catch (err: any) {
    setFlash(res, 'error', err.message ?? 'Erro ao criar usuário.');
    res.redirect('/users');
  }
}

export async function postUpdateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    await updateUser(req.params.id, data);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Usuário atualizado.' });
    }
    setFlash(res, 'success', 'Usuário atualizado.');
    res.redirect('/users');
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao atualizar usuário.');
    res.redirect('/users');
  }
}

export async function postResetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { newPassword } = z
      .object({ newPassword: z.string().min(6, 'Senha mínima 6 caracteres.') })
      .parse(req.body);

    await resetPassword(req.params.id, newPassword);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Senha redefinida.' });
    }
    setFlash(res, 'success', 'Senha redefinida com sucesso.');
    res.redirect('/users');
  } catch (err: any) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    setFlash(res, 'error', err.message ?? 'Erro ao redefinir senha.');
    res.redirect('/users');
  }
}
