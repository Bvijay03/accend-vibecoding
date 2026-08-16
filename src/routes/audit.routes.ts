import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as reconciliationService from '../services/reconciliation.service';

const router = Router();

/**
 * GET /audit/:groupId
 *
 * Returns the full reconciliation audit log for a group — every event's
 * resolution decision with timestamps and human-readable reasons.
 */
router.get(
  '/:groupId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groupId = req.params.groupId as string;
      const logs = await reconciliationService.getAuditLog(groupId);
      res.json({ groupId, logs });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
