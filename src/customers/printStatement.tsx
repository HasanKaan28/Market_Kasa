import type { CustomerRecord } from '@/data/types';
import { printView } from '@/pos/printView';
import type { StatementLine } from './statement';
import { StatementView } from './StatementView';

export type StatementModel = {
  marketName: string;
  customer: CustomerRecord;
  /** Oldest first, as `customerStatement` gives them. */
  lines: readonly StatementLine[];
  printedAt: Date;
};

const PAGE_RULE = '@page { size: A4; margin: 15mm; }';

/** Prints a customer's statement on A4; the print window can save it as a PDF. */
export function printStatement(model: StatementModel, print?: () => void): void {
  printView(<StatementView model={model} />, () => PAGE_RULE, print);
}
