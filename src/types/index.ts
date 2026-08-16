import { Decimal } from '@prisma/client/runtime/library';

/** Raw event payload from API request */
export interface EventInput {
  eventId: string;
  expenseId: string;
  amount: number;
  description: string;
  payerId: string;
  timestamp: string;
  source: string;
  groupId: string;
}

/** Event as stored in DB */
export interface StoredEvent {
  id: string;
  eventId: string;
  expenseId: string;
  amount: Decimal;
  description: string;
  payerId: string;
  groupId: string;
  source: string;
  timestamp: Date;
  status: string;
  createdAt: Date;
}

/** Result of conflict resolution for a single expense */
export interface ResolutionResult {
  expenseId: string;
  winner: StoredEvent;
  losers: StoredEvent[];
  decisions: AuditDecision[];
}

/** An audit decision to persist */
export interface AuditDecision {
  eventId: string;
  expenseId: string;
  groupId: string;
  decision: 'accepted' | 'rejected_duplicate' | 'rejected_conflict' | 'superseded';
  resolvedAmount: Decimal | null;
  source: string;
  timestamp: Date;
  reason: string;
}

/** A settlement transaction (who pays whom) */
export interface SettlementTransaction {
  from: string;
  to: string;
  amount: number;
}

/** Net balance entry for the cash flow algorithm */
export interface BalanceEntry {
  userId: string;
  balance: number;
}
