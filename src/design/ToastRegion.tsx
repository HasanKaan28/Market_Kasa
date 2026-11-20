import type { JSX } from 'react';

/**
 * Always present, so screen readers announce each new message. It sits above the phone's menu
 * bar, and at the top while a dialog is open (shape.css).
 */
export function ToastRegion({ message }: { message: string | null }): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Bildirim"
      aria-live="polite"
      className="toast-region pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
    >
      {message ? (
        <p className="max-w-[480px] animate-toast-in rounded-plate bg-text px-4 py-3 text-body font-medium text-white shadow-lg">
          {message}
        </p>
      ) : null}
    </div>
  );
}
