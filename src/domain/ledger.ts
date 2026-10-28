import { businessDate } from './businessDate';
import { assertSafeInteger, type Kurus } from './money';

export type LedgerKind = 'debt' | 'payment' | 'adjustment';

/** Signed amount: debts are positive, payments negative, adjustments either way. */
export type LedgerEntry = { kind: LedgerKind; amount: Kurus; occurredAt: string };

const DAY_MS = 86_400_000;

export function balance(entries: readonly LedgerEntry[]): Kurus {
  return entries.reduce((sum, entry) => {
    assertSign(entry);
    return sum + entry.amount;
  }, 0);
}

/**
 * Settles the ledger first-in-first-out: payments close the oldest open debts, and anything
 * left over becomes credit that later debts draw on. Returns when the oldest still-open debt
 * was incurred, or null when nothing is owed.
 */
export function oldestUnpaidDebt(entries: readonly LedgerEntry[]): string | null {
  const ordered = [...entries].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const open: { occurredAt: string; remaining: Kurus }[] = [];
  let head = 0;
  let credit = 0;

  for (const entry of ordered) {
    assertSign(entry);
    if (entry.amount > 0) {
      const covered = Math.min(credit, entry.amount);
      credit -= covered;
      if (entry.amount > covered) {
        open.push({ occurredAt: entry.occurredAt, remaining: entry.amount - covered });
      }
      continue;
    }
    let toApply = -entry.amount;
    while (toApply > 0 && head < open.length) {
      const debt = open[head];
      if (!debt) break;
      const used = Math.min(debt.remaining, toApply);
      debt.remaining -= used;
      toApply -= used;
      if (debt.remaining === 0) head += 1;
    }
    credit += toApply;
  }

  return open[head]?.occurredAt ?? null;
}

/** Whole days between the oldest open debt's business day and `today` (YYYY-MM-DD). */
export function debtAgeDays(entries: readonly LedgerEntry[], today: string): number {
  const oldest = oldestUnpaidDebt(entries);
  if (oldest === null) {
    return 0;
  }
  const since = businessDate(new Date(oldest));
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
