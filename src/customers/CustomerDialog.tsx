import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { archiveCustomer } from '@/data/customers';
import { Button, Dialog } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { debtAgeDays } from '@/domain/ledger';
import { formatTRY } from '@/domain/money';
import { whatsappLink } from '@/pos/receiptText';
import { CustomerFormDialog } from './CustomerFormDialog';
import { AdjustmentForm, PaymentForm } from './PaymentForm';
import { printStatement } from './printStatement';
import { reminderText } from './reminder';
import { customerStatement, formatBalance } from './statement';

export type CustomerDialogProps = {
  open: boolean;
  customerId: string;
  onClose(): void;
  /** Called with the message to show after a payment, an adjustment or an edit. */
  onDone(message: string): void;
};

type Panel = 'payment' | 'adjustment' | 'edit' | null;

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

/** One credit customer: balance and statement, and the payments and changes made to them. */
export function CustomerDialog({
  open,
  customerId,
  onClose,
  onDone,
}: CustomerDialogProps): JSX.Element {
  const { db, settings } = useData();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const view = useLiveQuery(async () => {
    const [customer, lines] = await Promise.all([
      db.customers.get(customerId),
      customerStatement(db, customerId),
    ]);
    return { customer, lines };
  }, [db, customerId]);
  const customer = view?.customer;
  const lines = view?.lines ?? [];
  const balance = lines.at(-1)?.balanceAfter ?? 0;
  const age = debtAgeDays(
    lines.map((line) => line.entry),
    businessDate(new Date()),
  );

  function saved(message: string) {
    setPanel(null);
    onDone(message);
  }

  async function archive() {
    setBusy(true);
    setFailure(undefined);
    try {
      await archiveCustomer(db, customerId, new Date());
      onDone('Müşteri arşivlendi.');
      onClose();
    } catch {
      setFailure('Müşteri arşivlenemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={customer?.name ?? 'Müşteri'}
      description={customer?.phone}
      size="lg"
    >
      {view ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <p className="font-semibold">{`Bakiye: ${formatBalance(balance)}`}</p>
            {balance > 0 ? <p>{`Borç yaşı: ${age} gün`}</p> : null}
            {customer && customer.creditLimit > 0 ? (
              <p className="text-text-2">{`Limit: ${formatTRY(customer.creditLimit)}`}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPanel('payment')}>Tahsilat al</Button>
            <Button onClick={() => setPanel('adjustment')}>Düzeltme</Button>
            <Button onClick={() => setPanel('edit')}>Düzenle</Button>
            <Button
              disabled={!customer}
              onClick={() =>
                customer &&
                printStatement({
                  marketName: settings.marketName,
                  customer,
                  lines,
                  printedAt: new Date(),
                })
              }
            >
              Ekstreyi yazdır
            </Button>
            {customer && balance > 0 ? (
              <a
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line bg-surface px-3.5 text-[15px] font-semibold text-text hover:border-line-strong"
                href={whatsappLink(
                  reminderText({
                    marketName: settings.marketName,
                    customerName: customer.name,
                    balance,
                    debtAgeDays: age,
                  }),
                  customer.phone,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp ile hatırlat
              </a>
            ) : null}
            <Button disabled={busy || balance !== 0} onClick={() => void archive()}>
              Arşivle
            </Button>
          </div>
          {balance !== 0 ? (
            <p className="text-sm text-text-2">Bakiyesi sıfır olmayan müşteri arşivlenemez.</p>
          ) : null}
          {failure ? (
            <p role="alert" className="font-medium text-danger">
              {failure}
            </p>
          ) : null}
          {panel === 'payment' ? (
            <PaymentForm
              customerId={customerId}
              balance={balance}
              onSaved={saved}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {panel === 'adjustment' ? (
            <AdjustmentForm
              customerId={customerId}
              onSaved={saved}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {lines.length === 0 ? (
            <p className="text-text-2">Bu müşterinin hareketi yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-left">
                <caption className="sr-only">Ekstre</caption>
                <thead className="border-b border-line-strong text-sm text-text-2">
                  <tr>
                    <th scope="col" className="w-28 py-2 pr-3 font-medium">
                      Tarih
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Açıklama
                    </th>
                    <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">
                      Tutar
                    </th>
                    <th scope="col" className="w-32 py-2 text-right font-medium">
                      Bakiye
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Newest first: the last payment is what a customer asks about. */}
                  {[...lines].reverse().map(({ entry, description, balanceAfter }) => (
                    <tr key={entry.id} className="border-b border-line align-top last:border-0">
                      <td className="py-2 pr-3 text-text-2">
                        {dateFormat.format(new Date(entry.occurredAt))}
                      </td>
                      <td className="py-2 pr-3 break-words">{description}</td>
                      <td className="py-2 pr-3 text-right">
                        {entry.amount < 0
                          ? `−${formatTRY(-entry.amount)}`
                          : formatTRY(entry.amount)}
                      </td>
                      <td className="py-2 text-right">{formatBalance(balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      {panel === 'edit' && customer ? (
        <CustomerFormDialog
          open
          customer={customer}
          onClose={() => setPanel(null)}
          onSaved={(message) => saved(message)}
        />
      ) : null}
    </Dialog>
  );
}
