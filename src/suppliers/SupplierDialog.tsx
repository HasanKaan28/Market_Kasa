import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { AdjustmentForm } from '@/customers/PaymentForm';
import { recordSupplierAdjustment } from '@/data/supplierLedger';
import { archiveSupplier } from '@/data/suppliers';
import { printStatement } from '@/customers/printStatement';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { SupplierFormDialog } from './SupplierFormDialog';
import { SupplierPaymentForm } from './SupplierPaymentForm';
import { formatSupplierBalance, SUPPLIER_CREDIT_LABEL, supplierStatement } from './statement';

export type SupplierDialogProps = {
  open: boolean;
  supplierId: string;
  onClose(): void;
  /** Called with the message to show after a payment or an edit. */
  onDone(message: string): void;
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

/** One supplier: what the market owes them, the statement, and the payments made to them. */
export function SupplierDialog({
  open,
  supplierId,
  onClose,
  onDone,
}: SupplierDialogProps): JSX.Element {
  const { db, settings } = useData();
  const { staff } = useSession();
  const [panel, setPanel] = useState<'payment' | 'adjustment' | 'edit' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const view = useLiveQuery(async () => {
    const [supplier, lines] = await Promise.all([
      db.suppliers.get(supplierId),
      supplierStatement(db, supplierId),
    ]);
    return { supplier, lines };
  }, [db, supplierId]);
  const supplier = view?.supplier;
  const lines = view?.lines ?? [];
  const balance = lines.at(-1)?.balanceAfter ?? 0;

  function saved(message: string) {
    setPanel(null);
    onDone(message);
  }

  async function archive() {
    setBusy(true);
    setFailure(undefined);
    try {
      await archiveSupplier(db, supplierId, new Date());
      onDone('Tedarikçi arşivlendi.');
      onClose();
    } catch {
      setFailure('Tedarikçi arşivlenemedi.');
    } finally {
      setBusy(false);
    }
  }

  const details = [
    supplier?.phone,
    supplier?.taxNo ? `VKN ${supplier.taxNo}` : undefined,
    supplier?.taxOffice,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={supplier?.name ?? 'Tedarikçi'}
      description={details || undefined}
      size="lg"
    >
      {view ? (
        <div className="flex flex-col gap-4">
          <p className="font-semibold">{`Bakiye: ${formatSupplierBalance(balance)}`}</p>
          <div className="flex flex-wrap gap-2">
            <Button aria-expanded={panel === 'payment'} onClick={() => setPanel('payment')}>
              Ödeme yap
            </Button>
            <Button aria-expanded={panel === 'adjustment'} onClick={() => setPanel('adjustment')}>
              Düzeltme
            </Button>
            <Button onClick={() => setPanel('edit')}>Düzenle</Button>
            <Button
              disabled={!supplier}
              onClick={() =>
                supplier &&
                printStatement({
                  marketName: settings.marketName,
                  title: 'Tedarikçi ekstresi',
                  party: supplier,
                  creditLabel: SUPPLIER_CREDIT_LABEL,
                  lines,
                  printedAt: new Date(),
                })
              }
            >
              Ekstreyi yazdır
            </Button>
            {supplier?.archivedAt ? null : (
              <Button disabled={busy || balance !== 0} onClick={() => setConfirming(true)}>
                Arşivle
              </Button>
            )}
          </div>
          {balance !== 0 && !supplier?.archivedAt ? (
            <p className="text-sm text-text-2">Bakiyesi sıfır olmayan tedarikçi arşivlenemez.</p>
          ) : null}
          {confirming ? (
            <div className="flex flex-col gap-3 rounded-control border border-line p-3">
              <p className="font-medium">Bu tedarikçi arşivlensin mi?</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" disabled={busy} onClick={() => void archive()}>
                  Evet, arşivle
                </Button>
                <Button onClick={() => setConfirming(false)}>Vazgeç</Button>
              </div>
            </div>
          ) : null}
          {failure ? (
            <p role="alert" className="font-medium text-danger">
              {failure}
            </p>
          ) : null}
          {panel === 'payment' ? (
            <SupplierPaymentForm
              supplierId={supplierId}
              balance={balance}
              onSaved={saved}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {panel === 'adjustment' ? (
            <AdjustmentForm
              save={(amount, note) =>
                recordSupplierAdjustment(
                  db,
                  { supplierId, amount, note, staffId: staff?.id },
                  new Date(),
                )
              }
              onSaved={saved}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {lines.length === 0 ? (
            <p className="text-text-2">Bu tedarikçinin hareketi yok.</p>
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
                      <td className="py-2 text-right">{formatSupplierBalance(balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      {panel === 'edit' && supplier ? (
        <SupplierFormDialog
          open
          supplier={supplier}
          onClose={() => setPanel(null)}
          onSaved={(message) => saved(message)}
        />
      ) : null}
    </Dialog>
  );
}
