import { useLiveQuery } from 'dexie-react-hooks';
import { MessageCircle, Plus } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { normalizeForSearch } from '@/data/text';
import { Button, ChoiceGroup, TextField, ToastRegion, useToast } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { formatTRY } from '@/domain/money';
import { whatsappLink } from '@/pos/receiptText';
import { CustomerDialog } from './CustomerDialog';
import { CustomerFormDialog } from './CustomerFormDialog';
import { reminderText } from './reminder';
import { customerSummaries, formatBalance, type CustomerSummary } from './statement';

type CustomerView = 'all' | 'debtors' | 'reminders';

const VIEWS: readonly { value: CustomerView; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'debtors', label: 'Borçlu' },
  { value: 'reminders', label: 'Hatırlatma' },
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
  // Who to remind first: the oldest debt, then the largest.
  if (view === 'reminders') {
    rows.sort((a, b) => b.debtAgeDays - a.debtAgeDays || b.balance - a.balance);
  }

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
                <th scope="col" className="w-24 py-2 pr-3 text-right font-medium sm:w-32">
                  Bakiye
                </th>
                <th scope="col" className="w-16 py-2 pr-3 text-right font-medium sm:w-24">
                  Borç yaşı
                </th>
                <th scope="col" className="hidden w-28 py-2 text-right font-medium md:table-cell">
                  Limit
                </th>
                {view === 'reminders' ? (
                  <th scope="col" className="w-14 py-2 pl-3 font-medium sm:w-36">
                    <span className="sr-only">Hatırlat</span>
                  </th>
                ) : null}
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
                      {customer.archivedAt ? (
                        <span className="ml-2 text-sm text-text-2">Arşivli</span>
                      ) : null}
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
                    {view === 'reminders' ? (
                      <td className="py-1.5 pl-3">
                        <a
                          aria-label={`WhatsApp ile hatırlat: ${customer.name}`}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line bg-surface px-3 text-[15px] font-semibold text-text hover:border-line-strong"
                          href={whatsappLink(
                            reminderText({
                              marketName: settings.marketName,
                              customerName: customer.name,
                              balance,
                              debtAgeDays,
                            }),
                            customer.phone,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle aria-hidden="true" size={18} />
                          <span className="hidden sm:inline">WhatsApp</span>
                        </a>
                      </td>
                    ) : null}
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
