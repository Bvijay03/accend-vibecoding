import prisma from '../utils/prisma';
import { EventInput } from '../schemas/event.schema';
import { ingestEvent } from './event.service';
import { detectAndResolveConflicts } from './conflict.service';
import { computeAndPersistSettlement } from './settlement.service';
import { AuditDecision, StoredEvent } from '../types';

/**
 * Full reconciliation pipeline for a single event:
 *   1. Ingest event (with idempotency)
 *   2. If duplicate eventId → log and return early
 *   3. Run conflict resolution on all group events
 *   4. Recompute settlement
 *   5. Return result with audit info
 */
export async function processEvent(input: EventInput) {
  // Step 1: Ingest
  const { created, event } = await ingestEvent(input);

  if (!created) {
    // Duplicate eventId — idempotent response
    return {
      status: 'duplicate',
      message: `Event ${input.eventId} already processed`,
      event: formatEvent(event),
    };
  }

  // Step 2: Run conflict resolution for the group
  const acceptedEvents = await detectAndResolveConflicts(input.groupId);

  // Step 3: Compute settlement
  const settlement = await computeAndPersistSettlement(
    input.groupId,
    acceptedEvents
  );

  // Step 4: Return result
  return {
    status: 'processed',
    message: `Event ${input.eventId} processed successfully`,
    event: formatEvent(event),
    settlement: {
      version: settlement.version,
      transactionCount: settlement.transactions.length,
    },
  };
}

/**
 * Replay a batch of events:
 *   1. Clear all existing data for affected groups
 *   2. Re-ingest all events in timestamp order
 *   3. Run conflict resolution per group
 *   4. Recompute settlements per group
 */
export async function replayEvents(inputs: EventInput[]) {
  // Determine affected groups
  const groupIds = [...new Set(inputs.map((e) => e.groupId))];

  // Clear existing data for affected groups
  await prisma.$transaction(async (tx) => {
    for (const groupId of groupIds) {
      await tx.settlement.deleteMany({ where: { groupId } });
      await tx.reconciliationLog.deleteMany({ where: { groupId } });
      await tx.expenseEvent.deleteMany({ where: { groupId } });
    }
  });

  // Sort events by timestamp for deterministic processing
  const sorted = [...inputs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Ingest all events
  for (const input of sorted) {
    await ingestEvent(input);
  }

  // Run reconciliation per group
  const results: Record<
    string,
    { acceptedCount: number; rejectedCount: number; settlement: any }
  > = {};

  for (const groupId of groupIds) {
    const acceptedEvents = await detectAndResolveConflicts(groupId);
    const settlement = await computeAndPersistSettlement(
      groupId,
      acceptedEvents
    );

    const totalEvents = await prisma.expenseEvent.count({
      where: { groupId },
    });

    results[groupId] = {
      acceptedCount: acceptedEvents.length,
      rejectedCount: totalEvents - acceptedEvents.length,
      settlement: {
        version: settlement.version,
        transactions: settlement.transactions,
      },
    };
  }

  return {
    status: 'replayed',
    groupsProcessed: groupIds.length,
    totalEvents: inputs.length,
    results,
  };
}

/**
 * Get the full audit trail for a group.
 */
export async function getAuditLog(groupId: string) {
  const logs = await prisma.reconciliationLog.findMany({
    where: { groupId },
    orderBy: { createdAt: 'asc' },
    select: {
      eventId: true,
      expenseId: true,
      decision: true,
      resolvedAmount: true,
      source: true,
      timestamp: true,
      reason: true,
      createdAt: true,
    },
  });

  return logs.map((log) => ({
    ...log,
    resolvedAmount: log.resolvedAmount ? Number(log.resolvedAmount) : null,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEvent(event: StoredEvent) {
  return {
    id: event.id,
    eventId: event.eventId,
    expenseId: event.expenseId,
    amount: Number(event.amount),
    description: event.description,
    payerId: event.payerId,
    groupId: event.groupId,
    source: event.source,
    timestamp: event.timestamp,
    status: event.status,
  };
}
