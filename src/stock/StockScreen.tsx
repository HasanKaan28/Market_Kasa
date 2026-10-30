import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { ChoiceGroup, ToastRegion, useToast } from '@/design';
import type { ProductRecord } from '@/data/types';
import { CriticalStock } from './CriticalStock';
import { GoodsReceipt } from './GoodsReceipt';
import { StockCount } from './StockCount';
import { addProduct, loadDraft, saveDraft } from './receiptDraft';

type StockView = 'receive' | 'count' | 'critical';

const VIEWS: readonly { value: StockView; label: string }[] = [
  { value: 'receive', label: 'Mal kabul' },
  { value: 'count', label: 'Sayım' },
  { value: 'critical', label: 'Kritik stok' },
];

/** Stock work: receiving goods, counting the shelf and the products that are running out. */
export function StockScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  const [view, setView] = useState<StockView>('receive');
  const toast = useToast();

  // The goods receipt reads its draft when it opens, so the product is written to the draft.
  function receive(product: ProductRecord) {
    saveDraft(addProduct(loadDraft(), product));
    setView('receive');
    toast.show(`${product.name} mal kabule eklendi.`);
  }

  return (
    <>
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
        {view === 'receive' ? <GoodsReceipt onDone={toast.show} /> : null}
        {view === 'count' ? <StockCount onDone={toast.show} /> : null}
        {view === 'critical' ? <CriticalStock onReceive={receive} /> : null}
      </AppShell>
      <ToastRegion message={toast.message} />
    </>
  );
}
