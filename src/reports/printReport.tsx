import { printView } from '@/pos/printView';
import { ReportView } from './ReportView';
import type { Summary } from './summary';

export type ReportModel = {
  marketName: string;
  /** The business days the report covers, YYYY-MM-DD. */
  from: string;
  to: string;
  /** "Tümü", or the register it is about. */
  register: string;
  /** Whether the reader may see gross profit. */
  showCost: boolean;
  summary: Summary;
  printedAt: Date;
};

const PAGE_RULE = '@page { size: A4; margin: 15mm; }';

/** Prints a sales report on A4; the print window can save it as a PDF. */
export function printReport(model: ReportModel, print?: () => void): void {
  printView(<ReportView model={model} />, () => PAGE_RULE, print);
}
