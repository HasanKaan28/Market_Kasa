import type { JSX, ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="rounded-chip border border-current/30 px-1.5 py-0.5 font-mono text-xs font-medium opacity-80">
      {children}
    </kbd>
  );
}
