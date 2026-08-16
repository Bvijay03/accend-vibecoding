/**
 * Minimum Cash Flow Settlement Algorithm
 *
 * Given a list of resolved expenses (each with a payerId, amount, and the set
 * of group members who split the cost equally), this module computes the
 * minimum set of transactions needed to settle all debts.
 *
 * Algorithm:
 *   1. Compute net balance for each member:
 *        net = (total they paid) − (their fair share of all expenses)
 *   2. Separate members into creditors (net > 0) and debtors (net < 0).
 *   3. Greedily match the max creditor with the max debtor, transferring the
 *      minimum of their absolute balances.  This settles at least one person
 *      per iteration.
 *   4. Repeat until all balances are zero (within floating-point tolerance).
 *
 * This is a **pure function** — no side effects, fully deterministic.
 */

import { SettlementTransaction } from '../types';

const EPSILON = 0.005; // half a cent tolerance for floating-point

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExpenseForSettlement {
  payerId: string;
  amount: number; // resolved amount
}

/**
 * Compute the settlement transactions for a group.
 *
 * @param expenses  Resolved expenses (after conflict resolution)
 * @param memberIds All member IDs in the group (used to compute fair shares)
 * @returns         Minimal list of settlement transactions
 */
export function computeSettlement(
  expenses: ExpenseForSettlement[],
  memberIds: string[]
): SettlementTransaction[] {
  if (memberIds.length === 0 || expenses.length === 0) return [];

  // Step 1: Compute net balances
  const balances = computeNetBalances(expenses, memberIds);

  // Step 2+3: Greedy settlement
  return greedySettle(balances);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function computeNetBalances(
  expenses: ExpenseForSettlement[],
  memberIds: string[]
): Map<string, number> {
  const balances = new Map<string, number>();

  // Initialise all members to 0
  for (const id of memberIds) {
    balances.set(id, 0);
  }

  const memberCount = memberIds.length;

  for (const expense of expenses) {
    const share = expense.amount / memberCount;

    // Payer is credited the full amount
    balances.set(
      expense.payerId,
      (balances.get(expense.payerId) ?? 0) + expense.amount
    );

    // Every member (including payer) owes their share
    for (const id of memberIds) {
      balances.set(id, (balances.get(id) ?? 0) - share);
    }
  }

  return balances;
}

function greedySettle(balances: Map<string, number>): SettlementTransaction[] {
  const transactions: SettlementTransaction[] = [];

  // Build sorted arrays of creditors and debtors
  // We work with mutable copies
  const entries = Array.from(balances.entries()).map(([userId, balance]) => ({
    userId,
    balance,
  }));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Find max creditor and max debtor
    let maxCreditor = { userId: '', balance: -Infinity };
    let maxDebtor = { userId: '', balance: Infinity };

    for (const entry of entries) {
      if (entry.balance > maxCreditor.balance) maxCreditor = entry;
      if (entry.balance < maxDebtor.balance) maxDebtor = entry;
    }

    // If both are within tolerance, we're done
    if (
      Math.abs(maxCreditor.balance) < EPSILON &&
      Math.abs(maxDebtor.balance) < EPSILON
    ) {
      break;
    }

    // If somehow we only have creditors or only debtors (shouldn't happen with
    // valid data), break to avoid infinite loop
    if (maxCreditor.balance <= EPSILON || maxDebtor.balance >= -EPSILON) {
      break;
    }

    // Transfer the smaller of the two absolute values
    const transferAmount = Math.min(
      maxCreditor.balance,
      Math.abs(maxDebtor.balance)
    );

    // Round to 2 decimal places
    const rounded = Math.round(transferAmount * 100) / 100;

    if (rounded > 0) {
      transactions.push({
        from: maxDebtor.userId,
        to: maxCreditor.userId,
        amount: rounded,
      });
    }

    // Update balances
    maxCreditor.balance -= transferAmount;
    maxDebtor.balance += transferAmount;
  }

  return transactions;
}
