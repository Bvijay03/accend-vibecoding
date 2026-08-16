import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate';
import { eventSchema, replaySchema } from '../schemas/event.schema';
import { authMiddleware } from '../middleware/auth';
import * as reconciliationService from '../services/reconciliation.service';

const router = Router();

/**
 * POST /events
 *
 * Ingest a single expense event. Handles:
 * - Duplicate eventId (returns 200 with existing data)
 * - Conflict detection and resolution
 * - Settlement recomputation
 */
router.post(
  '/',
  authMiddleware,
  validate(eventSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await reconciliationService.processEvent(req.body);

      if (result.status === 'duplicate') {
        res.status(200).json(result);
        return;
      }

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /events/replay
 *
 * Replay a batch of historical events. Clears existing data for affected
 * groups and re-processes all events deterministically.
 */
router.post(
  '/replay',
  authMiddleware,
  validate(replaySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await reconciliationService.replayEvents(req.body.events);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
