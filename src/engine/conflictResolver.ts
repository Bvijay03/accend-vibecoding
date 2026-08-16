/**
 * Deterministic Conflict Resolver
 *
 * Given a set of expense events that may conflict (multiple events for the
 * same expenseId+groupId), resolves which event "wins" using a strict,
 * deterministic rule chain:
 *
 *   1. Source reliability:  mobile (3) > web (2) > sync (1)
 *   2. Latest timestamp
 *   3. Highest amount
 *   4. Lexicographically smallest eventId  (final tiebreaker — guarantees determinism)
 *
 * This module is a **pure function** — it takes data in and returns decisions
 * out, with no side effects.  That makes it trivially testable and replayable.
 */

import { Decimal } from '@prisma/client/runtime/library';
import { config } from '../config';
import { AuditDecision, ResolutionResult, StoredEvent } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getReliability(source: string): number {
  return config.sourceReliability[source.toLowerCase()] ?? 0;
}

/**
 * Comparison function used to sort events so that the *best* candidate is at
 * index 0.  A negative return means `a` ranks higher than `b`.
 */
function compareEvents(a: StoredEvent, b: StoredEvent): number {
  // 1. Higher reliability wins
  const relDiff = getReliability(b.source) - getReliability(a.source);
  if (relDiff !== 0) return relDiff;

  // 2. Later timestamp wins
  const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
  if (timeDiff !== 0) return timeDiff;

  // 3. Higher amount wins
  const amountDiff = Number(b.amount) - Number(a.amount);
  if (amountDiff !== 0) return amountDiff;

  // 4. Lexicographically smallest eventId wins (deterministic tiebreaker)
  return a.eventId.localeCompare(b.eventId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Group events by expense key (`expenseId:groupId`) and, for each group,
 * determine the winning event and produce audit decisions for every event.
 */
export function resolveConflicts(events: StoredEvent[]): ResolutionResult[] {
  // Group by expenseId + groupId
  const grouped = new Map<string, StoredEvent[]>();

  for (const event of events) {
    const key = `${event.expenseId}:${event.groupId}`;
    const arr = grouped.get(key) ?? [];
    arr.push(event);
    grouped.set(key, arr);
  }

  const results: ResolutionResult[] = [];

  for (const [, group] of grouped) {
    // Sort so best candidate is first
    const sorted = [...group].sort(compareEvents);
    const winner = sorted[0];
    const losers = sorted.slice(1);

    const decisions: AuditDecision[] = [];

    // Winner decision
    decisions.push({
      eventId: winner.eventId,
      expenseId: winner.expenseId,
      groupId: winner.groupId,
      decision: 'accepted',
      resolvedAmount: winner.amount,
      source: winner.source,
      timestamp: winner.timestamp,
      reason:
        losers.length === 0
          ? 'Only event for this expense — accepted.'
          : buildWinnerReason(winner, losers),
    });

    // Loser decisions
    for (const loser of losers) {
      decisions.push({
        eventId: loser.eventId,
        expenseId: loser.expenseId,
        groupId: loser.groupId,
        decision: 'rejected_conflict',
        resolvedAmount: null,
        source: loser.source,
        timestamp: loser.timestamp,
        reason: buildLoserReason(loser, winner),
      });
    }

    results.push({ expenseId: winner.expenseId, winner, losers, decisions });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reason builders  (human-readable audit trail)
// ---------------------------------------------------------------------------

function buildWinnerReason(winner: StoredEvent, losers: StoredEvent[]): string {
  const reasons: string[] = [];

  for (const loser of losers) {
    const relW = getReliability(winner.source);
    const relL = getReliability(loser.source);

    if (relW > relL) {
      reasons.push(
        `Preferred over event ${loser.eventId}: higher source reliability (${winner.source}=${relW} > ${loser.source}=${relL}).`
      );
    } else if (winner.timestamp.getTime() > loser.timestamp.getTime()) {
      reasons.push(
        `Preferred over event ${loser.eventId}: later timestamp (${winner.timestamp.toISOString()} > ${loser.timestamp.toISOString()}).`
      );
    } else if (Number(winner.amount) > Number(loser.amount)) {
      reasons.push(
        `Preferred over event ${loser.eventId}: higher amount (${winner.amount} > ${loser.amount}).`
      );
    } else {
      reasons.push(
        `Preferred over event ${loser.eventId}: lexicographic eventId tiebreaker.`
      );
    }
  }

  return `Accepted — won conflict resolution. ${reasons.join(' ')}`;
}

function buildLoserReason(loser: StoredEvent, winner: StoredEvent): string {
  const relW = getReliability(winner.source);
  const relL = getReliability(loser.source);

  if (relW > relL) {
    return `Rejected — lost to event ${winner.eventId}: lower source reliability (${loser.source}=${relL} < ${winner.source}=${relW}).`;
  }
  if (winner.timestamp.getTime() > loser.timestamp.getTime()) {
    return `Rejected — lost to event ${winner.eventId}: earlier timestamp (${loser.timestamp.toISOString()} < ${winner.timestamp.toISOString()}).`;
  }
  if (Number(winner.amount) > Number(loser.amount)) {
    return `Rejected — lost to event ${winner.eventId}: lower amount (${loser.amount} < ${winner.amount}).`;
  }
  return `Rejected — lost to event ${winner.eventId}: lexicographic eventId tiebreaker.`;
}
