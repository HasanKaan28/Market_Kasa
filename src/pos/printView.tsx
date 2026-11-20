import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const ROOT_ID = 'print-root';
const PAGE_STYLE_ID = 'print-page';
const PRINTING_CLASS = 'printing-receipt';

/**
 * Prints one view through the browser's print window: the view is rendered into a root laid
 * out off-screen, the page rule is worked out from it (a receipt is measured for its height),
 * and only while it prints does the page hide everything else (app.css). All of it is undone
 * once printing is over, so a later Ctrl+P prints the screen as usual.
 */
export function printView(
  view: ReactNode,
  pageRule: (printed: HTMLElement) => string,
  print: () => void = () => window.print(),
): void {
  document.getElementById(ROOT_ID)?.remove();
  const container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.append(container);

  const root = createRoot(container);
  flushSync(() => root.render(view));
  const style = pageStyle();
  style.textContent = pageRule(container);
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
