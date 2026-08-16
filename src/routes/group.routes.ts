import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate';
import { createGroupSchema } from '../schemas/event.schema';
import { authMiddleware } from '../middleware/auth';
import prisma from '../utils/prisma';

const router = Router();

// Create a group
router.post(
  '/',
  authMiddleware,
  validate(createGroupSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, memberIds } = req.body;

      // Always include the creator
      const allMemberIds = [...new Set([req.user!.userId, ...memberIds])];

      const group = await prisma.group.create({
        data: {
          name,
          members: {
            create: allMemberIds.map((userId: string, idx: number) => ({
              userId,
              role: idx === 0 ? 'admin' : 'member',
            })),
          },
        },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });

      res.status(201).json(group);
    } catch (err) {
      next(err);
    }
  }
);

// Get a group by ID
router.get(
  '/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const group = await prisma.group.findUnique({
        where: { id },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });

      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.json(group);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
