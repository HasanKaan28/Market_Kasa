import { pageSizeRule } from './printPage';
import { printView } from './printView';
import type { ZReportModel } from './zReport';
import { ZReportView } from './ZReportView';

/** Prints a Z report like a receipt: on a page of the paper's width and the report's height. */
export function printZReport(
  model: ZReportModel,
  paperWidth: 58 | 80,
  print: () => void = () => window.print(),
): void {
  printView(
    <ZReportView model={model} paperWidth={paperWidth} />,
    (printed) => pageSizeRule(paperWidth, printed.getBoundingClientRect().height),
    print,
  );
}
