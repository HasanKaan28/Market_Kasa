import { businessDate } from './businessDate';
import { assertSafeInteger, type Kurus } from './money';

export type LedgerKind = 'debt' | 'payment' | 'adjustment';

/**
 * Signed amount: debts are positive, payments negative, adjustments either way. `saleId` ties a
 * sale's debt to the void or return that takes it back.
 */
export type LedgerEntry = {
  kind: LedgerKind;
  amount: Kurus;
  occurredAt: string;
  /** The business day it was written for; worked out from `occurredAt` when absent. */
  businessDate?: string;
  saleId?: string;
};

const DAY_MS = 86_400_000;

export function balance(entries: readonly LedgerEntry[]): Kurus {
  return entries.reduce((sum, entry) => {
    assertSign(entry);
    return sum + entry.amount;
  }, 0);
}

/**
 * Settles the ledger first-in-first-out: payments close the oldest open debts, and anything
 * left over becomes credit that later debts draw on. A void or return of a sale closes that
 * sale's debt first. Returns when the oldest still-open debt was incurred, or null when
 * nothing is owed.
 */
export function oldestUnpaidDebt(entries: readonly LedgerEntry[]): string | null {
  return oldestOpenDebt(entries)?.occurredAt ?? null;
}

function oldestOpenDebt(
  entries: readonly LedgerEntry[],
): { occurredAt: string; businessDate?: string } | null {
  const ordered = [...entries].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const open: {
    occurredAt: string;
    businessDate?: string;
    remaining: Kurus;
    saleId?: string;
  }[] = [];
  let credit = 0;

  for (const entry of ordered) {
    assertSign(entry);
    if (entry.amount > 0) {
      const covered = Math.min(credit, entry.amount);
      credit -= covered;
      if (entry.amount > covered) {
        open.push({
          occurredAt: entry.occurredAt,
          ...(entry.businessDate ? { businessDate: entry.businessDate } : {}),
          remaining: entry.amount - covered,
          saleId: entry.saleId,
        });
      }
      continue;
    }
    let toApply = -entry.amount;
    const own = open.filter((debt) => entry.saleId !== undefined && debt.saleId === entry.saleId);
    for (const debt of [...own, ...open]) {
      const used = Math.min(debt.remaining, toApply);
      debt.remaining -= used;
      toApply -= used;
    }
    credit += toApply;
  }

  return open.find((debt) => debt.remaining > 0) ?? null;
}

/**
 * Whole days between the oldest open debt's business day and `today` (YYYY-MM-DD), the day
 * found with the market's cutoff and time zone.
 */
export function debtAgeDays(
  entries: readonly LedgerEntry[],
  today: string,
  opts: { cutoffMinutes?: number; timeZone?: string } = {},
): number {
  const oldest = oldestOpenDebt(entries);
  if (oldest === null) {
    return 0;
  }
  const since = oldest.businessDate ?? businessDate(new Date(oldest.occurredAt), opts);
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / DAY_MS);
}

/** Current stock in thousandths of a unit. */
export function stockLevel(movements: readonly { delta: number }[]): number {
  return movements.reduce((sum, movement) => {
    assertSafeInteger(movement.delta, 'Stock delta (thousandths)');
    return sum + movement.delta;
  }, 0);
}

function assertSign(entry: LedgerEntry): void {
  assertSafeInteger(entry.amount, 'Ledger amount');
  if (entry.kind === 'debt' && entry.amount <= 0) {
    throw new RangeError(`A debt must be positive, got ${entry.amount}`);
  }
  if (entry.kind === 'payment' && entry.amount >= 0) {
    throw new RangeError(`A payment must be negative, got ${entry.amount}`);
  }
}
