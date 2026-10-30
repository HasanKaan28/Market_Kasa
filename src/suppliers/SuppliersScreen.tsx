import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { normalizeForSearch } from '@/data/text';
import { Button, TextField, ToastRegion, useToast } from '@/design';
import { SupplierDialog } from './SupplierDialog';
import { SupplierFormDialog } from './SupplierFormDialog';
import { formatSupplierBalance, supplierSummaries } from './statement';

/** The suppliers: who delivers, and what the market owes each of them. */
export function SuppliersScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'supplier'; id: string } | { kind: 'new' } | null>(
    null,
  );
  const summaries = useLiveQuery(() => supplierSummaries(db), [db]);
  const needle = normalizeForSearch(query.trim());
  const rows = (summaries ?? []).filter(
    ({ supplier }) => needle === '' || normalizeForSearch(supplier.name).includes(needle),
  );

  function done(message: string) {
    toast.show(message);
    void runner.run();
  }

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        activeNav="suppliers"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">Tedarikçiler</h1>
            {summaries ? (
              <p className="text-sm text-text-2">{`${summaries.length} tedarikçi`}</p>
            ) : null}
          </div>
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" size={18} />}
            onClick={() => setDialog({ kind: 'new' })}
          >
            Yeni tedarikçi
          </Button>
        </div>
        <TextField
          label="Tedarikçi ara"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {summaries && rows.length === 0 ? (
          <p className="text-text-2">
            {needle !== '' ? 'Bu aramaya uyan tedarikçi yok.' : 'Henüz tedarikçi yok.'}
          </p>
        ) : null}
        {rows.length > 0 ? (
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">Tedarikçiler</caption>
            <thead className="border-b border-line-strong text-sm text-text-2">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Tedarikçi
                </th>
                <th scope="col" className="hidden w-36 py-2 pr-3 font-medium sm:table-cell">
                  Telefon
                </th>
                <th scope="col" className="w-28 py-2 text-right font-medium sm:w-32">
                  Bakiye
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ supplier, balance }) => (
                <tr key={supplier.id} className="border-b border-line align-top last:border-0">
                  <td className="py-1.5 pr-3 break-words">
                    <button
                      type="button"
                      className="min-h-11 text-left font-medium hover:underline"
                      onClick={() => setDialog({ kind: 'supplier', id: supplier.id })}
                    >
                      {supplier.name}
                    </button>
                    {supplier.archivedAt ? (
                      <span className="ml-2 text-sm text-text-2">Arşivli</span>
                    ) : null}
                  </td>
                  <td className="hidden py-3 pr-3 text-text-2 sm:table-cell">
                    {supplier.phone ?? '—'}
                  </td>
                  <td className="py-3 text-right">{formatSupplierBalance(balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </AppShell>
      {dialog?.kind === 'supplier' ? (
        <SupplierDialog open supplierId={dialog.id} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === 'new' ? (
        <SupplierFormDialog
          open
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            done(message);
          }}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}
