import type { Kurus } from '@/domain/money';
import { printView } from '@/pos/printView';
import { StatementView } from './StatementView';

export type StatementModel = {
  marketName: string;
  /** "Müşteri ekstresi", "Tedarikçi ekstresi". */
  title: string;
  /** Whose statement it is. */
  party: { name: string; phone?: string };
  /** Oldest first, each entry followed by the balance it leaves. */
  lines: readonly {
    entry: { id: string; amount: Kurus; occurredAt: string };
    description: string;
    balanceAfter: Kurus;
  }[];
  printedAt: Date;
};

const PAGE_RULE = '@page { size: A4; margin: 15mm; }';

/** Prints a customer's or a supplier's statement on A4; the print window can save it as a PDF. */
export function printStatement(model: StatementModel, print?: () => void): void {
  printView(<StatementView model={model} />, () => PAGE_RULE, print);
}
