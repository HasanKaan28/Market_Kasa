import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { useSession } from '@/app/session';
import { ToastRegion, useToast } from '@/design';
import { ArchiveInvoices } from './ArchiveInvoices';
import { DocumentsList } from './DocumentsList';

type Tab = 'documents' | 'archive';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'documents', label: 'Alış ve satış' },
  { value: 'archive', label: 'e-Arşiv' },
];

/**
 * The market's papers: the sales and purchases of a range of days, and on a tab of its own the
 * e-Arşiv invoices asked for on sales. The sales and purchases add up to the market's takings, so
 * only those who may see the reports get that tab; others see the e-Arşiv invoices alone.
 */
export function InvoicesScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  const toast = useToast();
  const session = useSession();
  const tabs = session.can('reports') ? TABS : TABS.filter((option) => option.value === 'archive');
  const [chosen, setTab] = useState<Tab>(tabs[0]?.value ?? 'archive');
  const tab = tabs.some((option) => option.value === chosen) ? chosen : 'archive';

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        syncError={status.error}
        activeNav="invoices"
      >
        <h1 className="text-xl font-semibold">Faturalar</h1>
        <div role="tablist" aria-label="Faturalar" className="flex gap-2 border-b border-line">
          {tabs.map((option) => {
            const selected = tab === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                id={`invoices-tab-${option.value}`}
                aria-selected={selected}
                aria-controls={`invoices-panel-${option.value}`}
                onClick={() => setTab(option.value)}
                className={`-mb-px min-h-11 border-b-2 px-3 font-semibold ${selected ? 'border-accent text-text' : 'border-transparent text-text-2 hover:text-text'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`invoices-panel-${tab}`}
          aria-labelledby={`invoices-tab-${tab}`}
          className="flex flex-col gap-4"
        >
          {tab === 'documents' ? (
            <DocumentsList />
          ) : (
            <ArchiveInvoices onMessage={(message) => toast.show(message)} />
          )}
        </div>
      </AppShell>
      <ToastRegion message={toast.message} />
    </>
  );
}
