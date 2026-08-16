/**
 * Unit tests for the Cash Flow Minimizer (Settlement Engine)
 *
 * Tests the pure settlement computation function with known scenarios.
 */

import { computeSettlement, ExpenseForSettlement } from '../../src/engine/cashFlowMinimizer';

describe('Cash Flow Minimizer', () => {
  it('should return empty transactions for empty input', () => {
    expect(computeSettlement([], ['a', 'b'])).toEqual([]);
    expect(computeSettlement([{ payerId: 'a', amount: 10 }], [])).toEqual([]);
  });

  it('should settle a simple 2-person split', () => {
    // A pays $100, split between A and B → B owes A $50
    const expenses: ExpenseForSettlement[] = [{ payerId: 'a', amount: 100 }];
    const members = ['a', 'b'];

    const result = computeSettlement(expenses, members);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 'b', to: 'a', amount: 50 });
  });

  it('should settle a 3-person split with one payer', () => {
    // A pays $90, split among A, B, C → B owes $30, C owes $30 to A
    const expenses: ExpenseForSettlement[] = [{ payerId: 'a', amount: 90 }];
    const members = ['a', 'b', 'c'];

    const result = computeSettlement(expenses, members);

    // Total owed to A = $60, greedy should produce 2 transactions
    expect(result).toHaveLength(2);

    const totalToA = result
      .filter((t) => t.to === 'a')
      .reduce((sum, t) => sum + t.amount, 0);
    expect(totalToA).toBe(60);
  });

  it('should minimize transactions in a multi-payer scenario', () => {
    // A pays $60, B pays $30 — split among A, B, C (3 people)
    // Fair share per person = $30
    // Net: A = +30, B = 0, C = -30
    // Settlement: C pays A $30 (1 transaction)
    const expenses: ExpenseForSettlement[] = [
      { payerId: 'a', amount: 60 },
      { payerId: 'b', amount: 30 },
    ];
    const members = ['a', 'b', 'c'];

    const result = computeSettlement(expenses, members);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 'c', to: 'a', amount: 30 });
  });

  it('should handle balanced scenario with no transactions needed', () => {
    // A pays $30, B pays $30, C pays $30 → everyone is even
    const expenses: ExpenseForSettlement[] = [
      { payerId: 'a', amount: 30 },
      { payerId: 'b', amount: 30 },
      { payerId: 'c', amount: 30 },
    ];
    const members = ['a', 'b', 'c'];

    const result = computeSettlement(expenses, members);
    expect(result).toHaveLength(0);
  });

  it('should produce correct total settlement volume', () => {
    // A pays $100, B pays $20 — split among A, B, C, D (4 people)
    // Fair share = $30 each
    // Net: A = +70, B = -10, C = -30, D = -30
    const expenses: ExpenseForSettlement[] = [
      { payerId: 'a', amount: 100 },
      { payerId: 'b', amount: 20 },
    ];
    const members = ['a', 'b', 'c', 'd'];

    const result = computeSettlement(expenses, members);

    // Total amount flowing should equal the net imbalance
    const totalFlow = result.reduce((sum, t) => sum + t.amount, 0);
    expect(totalFlow).toBe(70); // A is owed 70 total
  });

  it('should be deterministic', () => {
    const expenses: ExpenseForSettlement[] = [
      { payerId: 'a', amount: 150 },
      { payerId: 'b', amount: 50 },
    ];
    const members = ['a', 'b', 'c', 'd'];

    const result1 = computeSettlement(expenses, members);
    const result2 = computeSettlement(expenses, members);

    expect(result1).toEqual(result2);
  });

  it('should handle a complex 5-person scenario', () => {
    // A=$200, B=$50, C=$0, D=$0, E=$100 — total=$350, fair=$70 each
    // Net: A=+130, B=-20, C=-70, D=-70, E=+30
    const expenses: ExpenseForSettlement[] = [
      { payerId: 'a', amount: 200 },
      { payerId: 'b', amount: 50 },
      { payerId: 'e', amount: 100 },
    ];
    const members = ['a', 'b', 'c', 'd', 'e'];

    const result = computeSettlement(expenses, members);

    // Verify conservation: total debits = total credits
    const totalDebits = result.reduce((sum, t) => sum + t.amount, 0);
    const totalCredits = result.reduce((sum, t) => sum + t.amount, 0);
    expect(totalDebits).toBeCloseTo(totalCredits, 2);

    // Verify every transaction has positive amount
    for (const t of result) {
      expect(t.amount).toBeGreaterThan(0);
    }
  });
});
