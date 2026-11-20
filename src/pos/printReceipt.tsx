import { pageSizeRule } from './printPage';
import { printView } from './printView';
import type { ReceiptModel } from './receipt';
import { ReceiptView } from './ReceiptView';

/** Prints one receipt on a page of the paper's width and the receipt's own height. */
export function printReceipt(
  model: ReceiptModel,
  paperWidth: 58 | 80,
  print: () => void = () => window.print(),
): void {
  printView(
    <ReceiptView model={model} paperWidth={paperWidth} />,
    (printed) => pageSizeRule(paperWidth, printed.getBoundingClientRect().height),
    print,
  );
}
