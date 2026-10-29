import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { pageSizeRule } from './printPage';
import type { ReceiptModel } from './receipt';
import { ReceiptView } from './ReceiptView';

const ROOT_ID = 'print-root';
const PAGE_STYLE_ID = 'print-page';
const PRINTING_CLASS = 'printing-receipt';

/**
 * Prints one receipt through the browser's print window: the receipt is rendered into a root
 * laid out off-screen, measured, and printed on a page of the paper's width and its own height;
 * only while it prints does the page hide everything else (app.css). All of it is undone once
 * printing is over, so a later Ctrl+P prints the screen as usual.
 */
export function printReceipt(
  model: ReceiptModel,
  paperWidth: 58 | 80,
  print: () => void = () => window.print(),
): void {
  document.getElementById(ROOT_ID)?.remove();
  const container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.append(container);

  const root = createRoot(container);
  flushSync(() => root.render(<ReceiptView model={model} paperWidth={paperWidth} />));
  const style = pageStyle();
  style.textContent = pageSizeRule(paperWidth, container.getBoundingClientRect().height);
  document.body.classList.add(PRINTING_CLASS);

  window.addEventListener(
    'afterprint',
    () => {
      root.unmount();
      container.remove();
      style.remove();
      document.body.classList.remove(PRINTING_CLASS);
    },
    { once: true },
  );
  print();
}

function pageStyle(): HTMLStyleElement {
  const existing = document.getElementById(PAGE_STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }
  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  document.head.append(style);
  return style;
}
