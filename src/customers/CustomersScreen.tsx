import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { normalizeForSearch } from '@/data/text';
import { Button, ChoiceGroup, TextField, ToastRegion, useToast } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { formatTRY } from '@/domain/money';
import { CustomerDialog } from './CustomerDialog';
import { CustomerFormDialog } from './CustomerFormDialog';
import { customerSummaries, formatBalance, type CustomerSummary } from './statement';

type CustomerView = 'all' | 'debtors';

const VIEWS: readonly { value: CustomerView; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'debtors', label: 'Borçlu' },
];

/** The credit customers: what each owes, since when, and against which limit. */
export function CustomersScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<CustomerView>('all');
  const [dialog, setDialog] = useState<{ kind: 'customer'; id: string } | { kind: 'new' } | null>(
    null,
  );
  const summaries = useLiveQuery(() => customerSummaries(db, businessDate(new Date())), [db]);
  function done(message: string) {
    toast.show(message);
    void runner.run();
  }

  const rows = (summaries ?? []).filter(
    (row) => (view === 'all' || row.balance > 0) && matches(row, query),
  );

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        activeNav="customers"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">Müşteriler</h1>
            <p className="text-sm text-text-2">{`${summaries?.length ?? 0} müşteri`}</p>
          </div>
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" size={18} />}
            onClick={() => setDialog({ kind: 'new' })}
          >
            Yeni müşteri
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Müşteri ara"
              hint="Ad ya da telefon"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ChoiceGroup
            legend="Göster"
            name="customerView"
            options={VIEWS}
            value={view}
            onChange={(next) => setView(next)}
          />
        </div>
        {summaries && rows.length === 0 ? (
          <p className="text-text-2">
            {query.trim() !== '' ? 'Bu aramaya uyan müşteri yok.' : 'Gösterilecek müşteri yok.'}
          </p>
        ) : null}
        {rows.length > 0 ? (
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">Müşteriler</caption>
            <thead className="border-b border-line-strong text-sm text-text-2">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Müşteri
                </th>
                <th scope="col" className="hidden w-36 py-2 pr-3 font-medium sm:table-cell">
                  Telefon
                </th>
                <th scope="col" className="w-32 py-2 pr-3 text-right font-medium">
                  Bakiye
                </th>
                <th scope="col" className="w-24 py-2 pr-3 text-right font-medium">
                  Borç yaşı
                </th>
                <th scope="col" className="hidden w-28 py-2 text-right font-medium md:table-cell">
                  Limit
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ customer, balance, debtAgeDays }) => {
                const overLimit = customer.creditLimit > 0 && balance > customer.creditLimit;
                return (
                  <tr key={customer.id} className="border-b border-line align-top last:border-0">
                    <td className="py-1.5 pr-3 break-words">
                      <button
                        type="button"
                        className="min-h-11 text-left font-medium hover:underline"
                        onClick={() => setDialog({ kind: 'customer', id: customer.id })}
                      >
                        {customer.name}
                      </button>
                    </td>
                    <td className="hidden py-3 pr-3 text-text-2 sm:table-cell">
                      {customer.phone ?? '—'}
                    </td>
                    <td
                      className={`py-3 pr-3 text-right ${overLimit ? 'font-medium text-warning' : ''}`}
                    >
                      {formatBalance(balance)}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      {balance > 0 ? `${debtAgeDays} gün` : '—'}
                    </td>
                    <td className="hidden py-3 text-right text-text-2 md:table-cell">
                      {customer.creditLimit > 0 ? formatTRY(customer.creditLimit) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </AppShell>
      {dialog?.kind === 'customer' ? (
        <CustomerDialog open customerId={dialog.id} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === 'new' ? (
        <CustomerFormDialog
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

/** A name containing the query, or a phone containing its digits. */
function matches({ customer }: CustomerSummary, query: string): boolean {
  const needle = normalizeForSearch(query.trim());
  if (needle === '') {
    return true;
  }
  const digits = query.replace(/\D/g, '');
  return (
    normalizeForSearch(customer.name).includes(needle) ||
    (digits !== '' && (customer.phone ?? '').includes(digits))
  );
}
