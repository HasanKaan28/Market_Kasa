import type { JSX, ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="rounded-chip border border-current/30 px-2 py-0.5 font-sans text-meta font-semibold opacity-80">
      {children}
    </kbd>
  );
}
