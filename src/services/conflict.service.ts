import prisma from '../utils/prisma';
import { resolveConflicts } from '../engine/conflictResolver';
import { AuditDecision, StoredEvent } from '../types';

/**
 * Run conflict detection and resolution on all events for a given group.
 *
 * 1. Fetches all events for the group
 * 2. Runs deterministic conflict resolution
 * 3. Updates event statuses in DB
 * 4. Persists audit decisions to ReconciliationLog
 *
 * Returns the list of accepted (winning) events.
 */
export async function detectAndResolveConflicts(
  groupId: string
): Promise<StoredEvent[]> {
  // Fetch all events for the group
  const allEvents = await prisma.expenseEvent.findMany({
    where: { groupId },
    orderBy: { timestamp: 'asc' },
  });

  if (allEvents.length === 0) return [];

  // Run pure conflict resolution
  const results = resolveConflicts(allEvents as unknown as StoredEvent[]);

  // Collect all decisions
  const allDecisions: AuditDecision[] = [];
  const acceptedEvents: StoredEvent[] = [];

  for (const result of results) {
    acceptedEvents.push(result.winner);
    allDecisions.push(...result.decisions);
  }

  // Persist in a transaction
  await prisma.$transaction(async (tx) => {
    // Clear previous reconciliation logs for this group
    await tx.reconciliationLog.deleteMany({ where: { groupId } });

    // Update event statuses
    for (const decision of allDecisions) {
      await tx.expenseEvent.update({
        where: { eventId: decision.eventId },
        data: {
          status:
            decision.decision === 'accepted' ? 'accepted' : decision.decision,
        },
      });
    }

    // Insert new reconciliation logs
    await tx.reconciliationLog.createMany({
      data: allDecisions.map((d) => ({
        eventId: d.eventId,
        expenseId: d.expenseId,
        groupId: d.groupId,
        decision: d.decision,
        resolvedAmount: d.resolvedAmount,
        source: d.source,
        timestamp: d.timestamp,
        reason: d.reason,
      })),
    });
  });

  return acceptedEvents;
}
