import prisma from '../utils/prisma';
import { Decimal } from '@prisma/client/runtime/library';
import { EventInput } from '../schemas/event.schema';
import { StoredEvent } from '../types';

/**
 * Ingest a single expense event.
 *
 * Returns `{ created: true, event }` if a new event was stored,
 * or `{ created: false, event }` if the eventId already exists (idempotent).
 */
export async function ingestEvent(
  input: EventInput
): Promise<{ created: boolean; event: StoredEvent }> {
  // Check for duplicate eventId
  const existing = await prisma.expenseEvent.findUnique({
    where: { eventId: input.eventId },
  });

  if (existing) {
    return { created: false, event: existing as unknown as StoredEvent };
  }

  const event = await prisma.expenseEvent.create({
    data: {
      eventId: input.eventId,
      expenseId: input.expenseId,
      amount: new Decimal(input.amount),
      description: input.description,
      payerId: input.payerId,
      groupId: input.groupId,
      source: input.source,
      timestamp: new Date(input.timestamp),
      status: 'pending',
    },
  });

  return { created: true, event: event as unknown as StoredEvent };
}

/**
 * Retrieve all events for a group.
 */
export async function getGroupEvents(groupId: string): Promise<StoredEvent[]> {
  const events = await prisma.expenseEvent.findMany({
    where: { groupId },
    orderBy: { timestamp: 'asc' },
  });
  return events as unknown as StoredEvent[];
}

/**
 * Bulk insert events (for replay). Skips duplicates by eventId.
 */
export async function bulkIngestEvents(
  inputs: EventInput[]
): Promise<StoredEvent[]> {
  const created: StoredEvent[] = [];

  for (const input of inputs) {
    const existing = await prisma.expenseEvent.findUnique({
      where: { eventId: input.eventId },
    });
    if (existing) continue;

    const event = await prisma.expenseEvent.create({
      data: {
        eventId: input.eventId,
        expenseId: input.expenseId,
        amount: new Decimal(input.amount),
        description: input.description,
        payerId: input.payerId,
        groupId: input.groupId,
        source: input.source,
        timestamp: new Date(input.timestamp),
        status: 'pending',
      },
    });
    created.push(event as unknown as StoredEvent);
  }

  return created;
}
