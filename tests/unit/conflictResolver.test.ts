/**
 * Unit tests for the Conflict Resolution Engine
 *
 * These test the pure conflict resolver function in isolation — no database,
 * no side effects. Every test provides StoredEvent-like objects and asserts
 * on the deterministic output.
 */

import { resolveConflicts } from '../../src/engine/conflictResolver';
import { Decimal } from '@prisma/client/runtime/library';
import { StoredEvent } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<StoredEvent> & { eventId: string; expenseId: string }): StoredEvent {
  return {
    id: overrides.id ?? overrides.eventId,
    eventId: overrides.eventId,
    expenseId: overrides.expenseId,
    amount: overrides.amount ?? new Decimal(10),
    description: overrides.description ?? 'Test expense',
    payerId: overrides.payerId ?? 'user-a',
    groupId: overrides.groupId ?? 'group-1',
    source: overrides.source ?? 'mobile',
    timestamp: overrides.timestamp ?? new Date('2024-03-15T12:00:00Z'),
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Conflict Resolver', () => {
  it('should accept a single event with no conflicts', () => {
    const events = [makeEvent({ eventId: 'e1', expenseId: 'x1' })];
    const results = resolveConflicts(events);

    expect(results).toHaveLength(1);
    expect(results[0].winner.eventId).toBe('e1');
    expect(results[0].losers).toHaveLength(0);
    expect(results[0].decisions).toHaveLength(1);
    expect(results[0].decisions[0].decision).toBe('accepted');
  });

  it('should prefer higher source reliability (mobile > web)', () => {
    const events = [
      makeEvent({
        eventId: 'e-web',
        expenseId: 'x1',
        source: 'web',
        amount: new Decimal(100),
        timestamp: new Date('2024-03-15T12:00:00Z'),
      }),
      makeEvent({
        eventId: 'e-mobile',
        expenseId: 'x1',
        source: 'mobile',
        amount: new Decimal(50),
        timestamp: new Date('2024-03-15T12:00:00Z'),
      }),
    ];

    const results = resolveConflicts(events);
    expect(results[0].winner.eventId).toBe('e-mobile');
    expect(results[0].losers[0].eventId).toBe('e-web');
  });

  it('should prefer higher source reliability (web > sync)', () => {
    const events = [
      makeEvent({ eventId: 'e-sync', expenseId: 'x1', source: 'sync' }),
      makeEvent({ eventId: 'e-web', expenseId: 'x1', source: 'web' }),
    ];

    const results = resolveConflicts(events);
    expect(results[0].winner.eventId).toBe('e-web');
  });

  it('should prefer later timestamp when source is the same', () => {
    const events = [
      makeEvent({
        eventId: 'e-early',
        expenseId: 'x1',
        source: 'mobile',
        timestamp: new Date('2024-03-15T09:00:00Z'),
      }),
      makeEvent({
        eventId: 'e-late',
        expenseId: 'x1',
        source: 'mobile',
        timestamp: new Date('2024-03-15T10:00:00Z'),
      }),
    ];

    const results = resolveConflicts(events);
    expect(results[0].winner.eventId).toBe('e-late');
  });

  it('should prefer higher amount when source and timestamp are the same', () => {
    const ts = new Date('2024-03-15T12:00:00Z');
    const events = [
      makeEvent({
        eventId: 'e-low',
        expenseId: 'x1',
        source: 'web',
        timestamp: ts,
        amount: new Decimal(20),
      }),
      makeEvent({
        eventId: 'e-high',
        expenseId: 'x1',
        source: 'web',
        timestamp: ts,
        amount: new Decimal(25),
      }),
    ];

    const results = resolveConflicts(events);
    expect(results[0].winner.eventId).toBe('e-high');
  });

  it('should use lexicographic eventId as final tiebreaker', () => {
    const ts = new Date('2024-03-15T12:00:00Z');
    const amt = new Decimal(50);
    const events = [
      makeEvent({ eventId: 'e-zzz', expenseId: 'x1', source: 'mobile', timestamp: ts, amount: amt }),
      makeEvent({ eventId: 'e-aaa', expenseId: 'x1', source: 'mobile', timestamp: ts, amount: amt }),
    ];

    const results = resolveConflicts(events);
    // Lexicographically smallest eventId wins
    expect(results[0].winner.eventId).toBe('e-aaa');
  });

  it('should handle multiple expense groups independently', () => {
    const events = [
      makeEvent({ eventId: 'e1', expenseId: 'x1', source: 'web' }),
      makeEvent({ eventId: 'e2', expenseId: 'x1', source: 'mobile' }),
      makeEvent({ eventId: 'e3', expenseId: 'x2', source: 'sync' }),
      makeEvent({ eventId: 'e4', expenseId: 'x2', source: 'web' }),
    ];

    const results = resolveConflicts(events);
    expect(results).toHaveLength(2);

    const x1Result = results.find((r) => r.expenseId === 'x1')!;
    const x2Result = results.find((r) => r.expenseId === 'x2')!;

    expect(x1Result.winner.eventId).toBe('e2'); // mobile > web
    expect(x2Result.winner.eventId).toBe('e4'); // web > sync
  });

  it('should produce human-readable audit reasons', () => {
    const events = [
      makeEvent({ eventId: 'e-web', expenseId: 'x1', source: 'web' }),
      makeEvent({ eventId: 'e-mobile', expenseId: 'x1', source: 'mobile' }),
    ];

    const results = resolveConflicts(events);
    const winnerDecision = results[0].decisions.find((d) => d.decision === 'accepted')!;
    const loserDecision = results[0].decisions.find((d) => d.decision === 'rejected_conflict')!;

    expect(winnerDecision.reason).toContain('higher source reliability');
    expect(loserDecision.reason).toContain('lower source reliability');
  });

  it('should be deterministic — same input always produces same output', () => {
    const events = [
      makeEvent({ eventId: 'e-b', expenseId: 'x1', source: 'web', amount: new Decimal(30) }),
      makeEvent({ eventId: 'e-a', expenseId: 'x1', source: 'web', amount: new Decimal(30) }),
      makeEvent({ eventId: 'e-c', expenseId: 'x1', source: 'web', amount: new Decimal(30) }),
    ];

    // Run 10 times, should always produce the same result
    const firstResult = resolveConflicts(events);
    for (let i = 0; i < 10; i++) {
      const result = resolveConflicts([...events].sort(() => Math.random() - 0.5));
      expect(result[0].winner.eventId).toBe(firstResult[0].winner.eventId);
    }
  });

  it('should handle three-way conflict with mixed tiebreaker levels', () => {
    const events = [
      makeEvent({
        eventId: 'e1',
        expenseId: 'x1',
        source: 'mobile',
        timestamp: new Date('2024-03-15T09:00:00Z'),
        amount: new Decimal(100),
      }),
      makeEvent({
        eventId: 'e2',
        expenseId: 'x1',
        source: 'web',
        timestamp: new Date('2024-03-15T12:00:00Z'),
        amount: new Decimal(200),
      }),
      makeEvent({
        eventId: 'e3',
        expenseId: 'x1',
        source: 'sync',
        timestamp: new Date('2024-03-15T15:00:00Z'),
        amount: new Decimal(300),
      }),
    ];

    const results = resolveConflicts(events);
    // mobile has highest reliability (3), so e1 wins despite lower timestamp/amount
    expect(results[0].winner.eventId).toBe('e1');
    expect(results[0].losers).toHaveLength(2);
  });
});
