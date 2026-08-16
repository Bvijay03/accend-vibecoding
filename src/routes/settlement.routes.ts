import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as settlementService from '../services/settlement.service';

const router = Router();

/**
 * GET /settlement/:groupId
 *
 * Returns the latest computed settlement for a group — the minimum set of
 * transactions needed to balance all debts.
 */
router.get(
  '/:groupId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groupId = req.params.groupId as string;
      const settlement = await settlementService.getLatestSettlement(groupId);
      res.json(settlement);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
