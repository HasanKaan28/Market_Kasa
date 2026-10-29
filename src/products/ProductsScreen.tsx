import type { JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';

/** The catalogue: every product with its stock and category, and the way to add or change one. */
export function ProductsScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);

  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      activeNav="products"
    >
      <h1 className="text-xl font-semibold">Ürünler</h1>
    </AppShell>
  );
}
