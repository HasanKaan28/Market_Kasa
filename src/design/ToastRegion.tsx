import type { JSX } from 'react';

/** Always present, so screen readers announce each new message. */
export function ToastRegion({ message }: { message: string | null }): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Bildirim"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {message ? (
        <p className="rounded-control bg-text px-4 py-3 text-[15px] font-medium text-white shadow-lg">
          {message}
        </p>
      ) : null}
    </div>
  );
}
