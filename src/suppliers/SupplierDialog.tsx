import { formatDay } from '@/data/dates';
import { documentDay } from '@/data/supplierLedger';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { useApproval } from '@/app/useApproval';
import { AdjustmentForm } from '@/customers/PaymentForm';
import { reversePurchase, reverseSupplierPayment } from '@/data/corrections';
import { recordSupplierAdjustment } from '@/data/supplierLedger';
import type { PurchaseRecord, SupplierLedgerRecord } from '@/data/types';
import { archiveSupplier } from '@/data/suppliers';
import { printStatement } from '@/customers/printStatement';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { GoodsReceipt } from '@/stock/GoodsReceipt';
import { Chip, ReverseForm } from './ReverseForm';
import { SupplierFormDialog } from './SupplierFormDialog';
import { invoiceName } from './labels';
import { SupplierInvoices } from './SupplierInvoices';
import { SupplierPaymentForm } from './SupplierPaymentForm';
import { formatSupplierBalance, SUPPLIER_CREDIT_LABEL, supplierStatement } from './statement';

export type SupplierDialogProps = {
  open: boolean;
  supplierId: string;
  onClose(): void;
  /** Called with the message to show after a payment or an edit. */
  onDone(message: string): void;
};

/** A record being taken back or corrected, once a permitted person has said so. */
type Action =
  | { kind: 'reversePurchase' | 'correctPurchase'; purchase: PurchaseRecord }
  | { kind: 'reversePayment' | 'correctPayment'; entry: SupplierLedgerRecord; name: string };

/**
 * One supplier: what the market owes them, the statement, and the payments made to them. An
 * invoice or a payment typed wrong is taken back ("Geri al") or corrected ("Düzelt") here; that
 * needs a manager's or the owner's say, asked for as the register asks for it.
 */
export function SupplierDialog({
  open,
  supplierId,
  onClose,
  onDone,
}: SupplierDialogProps): JSX.Element {
  const { db, settings, runner } = useData();
  const { staff } = useSession();
  const actor = useActor();
  const approval = useApproval();
  const { cutoffMinutes } = useMarketSettings();
  const [panel, setPanel] = useState<'payment' | 'adjustment' | 'edit' | null>(null);
  const [action, setAction] = useState<Action | null>(null);
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

  function ask(next: Action) {
    approval.ask('correctSupplier', () => {
      setPanel(null);
      setAction(next);
    });
  }

  function acted(message: string) {
    setAction(null);
    onDone(message);
    void runner.run();
  }

  // An invoice on the statement is corrected or taken back as its goods receipt.
  async function askForInvoice(entry: SupplierLedgerRecord, kind: 'reverse' | 'correct') {
    const purchase = entry.purchaseId ? await db.purchases.get(entry.purchaseId) : undefined;
    if (!purchase) {
      setFailure('Bu faturanın mal kabulü bu kasaya henüz gelmedi.');
      return;
    }
    ask({ kind: kind === 'reverse' ? 'reversePurchase' : 'correctPurchase', purchase });
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
            <Button
              aria-expanded={panel === 'payment'}
              onClick={() => {
                setAction(null);
                setPanel('payment');
              }}
            >
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
                  // Paper cannot strike through: a line taken back says so in words.
                  lines: lines.map((line) =>
                    line.reversed
                      ? { ...line, description: `${line.description} (geri alındı)` }
                      : line,
                  ),
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
                  { supplierId, amount, note, staffId: staff?.id, cutoffMinutes },
                  new Date(),
                )
              }
              onSaved={saved}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {action?.kind === 'reversePurchase' ? (
            <ReverseForm
              question={`${invoiceName(action.purchase)} geri alınsın mı?`}
              hint="Stok ve borç geri alınır, kasadan ödendiyse para bu kasaya geri girer; ürün fiyatları değişmez."
              onConfirm={async (reason) => {
                await reversePurchase(
                  db,
                  { purchaseId: action.purchase.id, reason },
                  new Date(),
                  actor,
                );
                acted('Fatura geri alındı.');
              }}
              onCancel={() => setAction(null)}
            />
          ) : null}
          {action?.kind === 'reversePayment' ? (
            <ReverseForm
              question={`${action.name} geri alınsın mı?`}
              hint="Ödeme tutarı borca geri eklenir, kasadan ödendiyse para bu kasaya geri girer."
              onConfirm={async (reason) => {
                await reverseSupplierPayment(
                  db,
                  { entryId: action.entry.id, reason },
                  new Date(),
                  actor,
                );
                acted('Ödeme geri alındı.');
              }}
              onCancel={() => setAction(null)}
            />
          ) : null}
          {action?.kind === 'correctPayment' ? (
            <SupplierPaymentForm
              key={action.entry.id}
              supplierId={supplierId}
              balance={balance}
              correcting={action.entry}
              onSaved={acted}
              onCancel={() => setAction(null)}
            />
          ) : null}
          <SupplierInvoices
            supplierId={supplierId}
            onCorrect={(purchase) => ask({ kind: 'correctPurchase', purchase })}
            onReverse={(purchase) => ask({ kind: 'reversePurchase', purchase })}
          />
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
                    <th scope="col" className="py-2 pl-3 font-medium">
                      <span className="sr-only">İşlem</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...lines].reverse().map(({ entry, description, balanceAfter, reversed }) => {
                    const struck = reversed ? 'line-through' : '';
                    // Payments and invoices of goods receipts can be put right; the
                    // counter-entries and adjustments that put things right cannot.
                    const correctable =
                      !reversed &&
                      (entry.kind === 'payment' ||
                        (entry.kind === 'invoice' && entry.purchaseId !== undefined));
                    return (
                      <tr key={entry.id} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pr-3 text-text-2">{formatDay(documentDay(entry))}</td>
                        <td className="py-2 pr-3 break-words">
                          <span className={struck}>{description}</span>
                          {reversed ? (
                            <>
                              {' '}
                              <Chip tone="danger">Geri alındı</Chip>
                            </>
                          ) : null}
                          {entry.correctsId ? (
                            <>
                              {' '}
                              <Chip tone="muted">Düzeltme</Chip>
                            </>
                          ) : null}
                        </td>
                        <td className={`py-2 pr-3 text-right ${struck}`}>
                          {entry.amount < 0
                            ? `−${formatTRY(-entry.amount)}`
                            : formatTRY(entry.amount)}
                        </td>
                        <td className="py-2 text-right">{formatSupplierBalance(balanceAfter)}</td>
                        <td className="py-1 pl-3">
                          {correctable ? (
                            <div className="flex justify-end gap-1 whitespace-nowrap">
                              <Button
                                aria-label={`Düzelt: ${description}`}
                                onClick={() =>
                                  entry.kind === 'payment'
                                    ? ask({ kind: 'correctPayment', entry, name: description })
                                    : void askForInvoice(entry, 'correct')
                                }
                              >
                                Düzelt
                              </Button>
                              <Button
                                variant="ghost"
                                aria-label={`Geri al: ${description}`}
                                onClick={() =>
                                  entry.kind === 'payment'
                                    ? ask({ kind: 'reversePayment', entry, name: description })
                                    : void askForInvoice(entry, 'reverse')
                                }
                              >
                                Geri al
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      {action?.kind === 'correctPurchase' ? (
        <Dialog
          open
          onOpenChange={(next) => !next && setAction(null)}
          title="Faturayı düzelt"
          description={invoiceName(action.purchase)}
          size="lg"
        >
          <GoodsReceipt
            key={action.purchase.id}
            onDone={onDone}
            correcting={{ purchase: action.purchase, onCorrected: acted }}
          />
        </Dialog>
      ) : null}
      {approval.dialog}
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
