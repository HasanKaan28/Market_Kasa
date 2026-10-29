import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { ChoiceGroup } from '@/design';

type StockView = 'receive' | 'critical';

const VIEWS: readonly { value: StockView; label: string }[] = [
  { value: 'receive', label: 'Mal kabul' },
  { value: 'critical', label: 'Kritik stok' },
];

/** Stock work: receiving goods and the products that are running out. */
export function StockScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  const [view, setView] = useState<StockView>('receive');

  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      activeNav="stock"
    >
      <h1 className="text-xl font-semibold">Stok</h1>
      <ChoiceGroup
        legend="Göster"
        name="stockView"
        options={VIEWS}
        value={view}
        onChange={(next) => setView(next)}
      />
    </AppShell>
  );
}
