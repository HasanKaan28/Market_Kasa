import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ReceiptModel } from './receipt';
import { ReceiptView } from './ReceiptView';

const ROOT_ID = 'print-root';
const PAGE_STYLE_ID = 'print-page';

/**
 * Prints one receipt through the browser's print window: the receipt is rendered into a root
 * that only print styles show (app.css hides everything else), the page is sized to the paper,
 * and the root is removed once printing is over.
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
  pageStyle().textContent = `@page { size: ${paperWidth}mm auto; margin: 0; }`;

  const root = createRoot(container);
  flushSync(() => root.render(<ReceiptView model={model} paperWidth={paperWidth} />));

  window.addEventListener(
    'afterprint',
    () => {
      root.unmount();
      container.remove();
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
