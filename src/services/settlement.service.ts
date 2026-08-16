import prisma from '../utils/prisma';
import {
  computeSettlement,
  ExpenseForSettlement,
} from '../engine/cashFlowMinimizer';
import { SettlementTransaction, StoredEvent } from '../types';

/**
 * Compute and persist the settlement for a group based on accepted events.
 *
 * @param groupId        The group to settle
 * @param acceptedEvents The events that won conflict resolution
 * @returns              The list of settlement transactions
 */
export async function computeAndPersistSettlement(
  groupId: string,
  acceptedEvents: StoredEvent[]
): Promise<{ version: number; transactions: SettlementTransaction[] }> {
  // Get group members
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });

  const memberIds = members.map((m) => m.userId);

  if (memberIds.length === 0) {
    return { version: 0, transactions: [] };
  }

  // Build expense data for the settlement engine
  const expenses: ExpenseForSettlement[] = acceptedEvents.map((e) => ({
    payerId: e.payerId,
    amount: Number(e.amount),
  }));

  // Run pure settlement algorithm
  const transactions = computeSettlement(expenses, memberIds);

  // Get next version
  const lastSettlement = await prisma.settlement.findFirst({
    where: { groupId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (lastSettlement?.version ?? 0) + 1;

  // Persist in a transaction
  await prisma.$transaction(async (tx) => {
    // Delete previous version settlements (keep history clean)
    // Actually, we keep old versions for history — just add new ones
    await tx.settlement.createMany({
      data: transactions.map((t) => ({
        groupId,
        fromId: t.from,
        toId: t.to,
        amount: t.amount,
        version: nextVersion,
      })),
    });
  });

  return { version: nextVersion, transactions };
}

/**
 * Get the latest settlement for a group.
 */
export async function getLatestSettlement(groupId: string) {
  const lastSettlement = await prisma.settlement.findFirst({
    where: { groupId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  if (!lastSettlement) {
    return { version: 0, transactions: [], computedAt: null };
  }

  const settlements = await prisma.settlement.findMany({
    where: { groupId, version: lastSettlement.version },
    select: {
      fromId: true,
      toId: true,
      amount: true,
      createdAt: true,
    },
  });

  return {
    version: lastSettlement.version,
    transactions: settlements.map((s) => ({
      from: s.fromId,
      to: s.toId,
      amount: Number(s.amount),
    })),
    computedAt: settlements[0]?.createdAt ?? null,
  };
}
