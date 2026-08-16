import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate';
import { registerSchema, loginSchema } from '../schemas/event.schema';
import * as authService from '../services/auth.service';

const router = Router();

router.post(
  '/register',
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.register(
        req.body.email,
        req.body.name,
        req.body.password
      );
      res.status(201).json(result);
    } catch (err: any) {
      if (err.status) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

router.post(
  '/login',
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.login(req.body.email, req.body.password);
      res.json(result);
    } catch (err: any) {
      if (err.status) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

export default router;
