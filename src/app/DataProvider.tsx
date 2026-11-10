import type { JSX, ReactNode } from 'react';
import { DataContext, type AppData } from './appData';

export function DataProvider({
  value,
  children,
}: {
  value: AppData;
  children: ReactNode;
}): JSX.Element {
  return <DataContext value={value}>{children}</DataContext>;
}
