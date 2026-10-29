import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useReducer, useRef, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { findProductByBarcode } from '@/data/products';
import { saleStatus } from '@/data/returns';
import type { Payment, ProductRecord, SaleRecord } from '@/data/types';
import { Button, ToastRegion, useToast } from '@/design';
import { formatTRY, type Kurus } from '@/domain/money';
import { CART_STORAGE_KEY, cartReducer, cartTotals, loadCart, saveCart } from './cart';
import { CartPanel } from './CartPanel';
import { checkout, checkoutErrorMessage, singlePayment, StaleCartError } from './checkout';
import { CustomerPicker } from './CustomerPicker';
import { DiscountDialog } from './DiscountDialog';
import { HELD_STORAGE_KEY, holdCart, loadHeld, MAX_HELD, saveHeld, takeHeld } from './held';
import { HeldCartsDialog } from './HeldCartsDialog';
import { useBarcodeScanner, useShortcuts } from './keyboard';
import { LineDialog } from './LineDialog';
import { NewProductDialog } from './NewProductDialog';
import { PaymentDialog } from './PaymentDialog';
import { printReceipt } from './printReceipt';
import { PAYMENT_LABELS } from './format';
import { ProductPanel } from './ProductPanel';
import { buildReceipt } from './receipt';
import { ReceiptsDialog } from './ReceiptsDialog';
import { ReceiptSettingsDialog } from './ReceiptSettingsDialog';
import {
  loadReceiptSettings,
  receiptContext,
  saveReceiptSettings,
  type ReceiptSettings,
} from './receiptSettings';
import { ReturnDialog } from './ReturnDialog';
import { SplitPaymentDialog } from './SplitPaymentDialog';
import { VoidDialog } from './VoidDialog';

type OpenDialog =
  | { kind: 'cash' | 'card' }
  | { kind: 'credit' }
  | { kind: 'split' }
  | { kind: 'discount' }
  | { kind: 'line'; productId: string }
  | { kind: 'receiptSettings' }
  | { kind: 'newProduct'; barcode?: string }
  | { kind: 'held' }
  | { kind: 'receipts' }
  | { kind: 'void' | 'return'; sale: SaleRecord }
  | null;

/** The register: search and scan on the left, the cart and payment on the right. */
export function PosScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const [cart, dispatch] = useReducer(cartReducer, undefined, () => loadCart());
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [held, setHeld] = useState(() => loadHeld());
  const [receiptSettings, setReceiptSettings] = useState(() => loadReceiptSettings());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const hasItems = cart.lines.length > 0;
  const editedLine =
    dialog?.kind === 'line'
      ? cart.lines.find((line) => line.productId === dialog.productId)
      : undefined;
  // A line editor whose line vanished (another tab, a refresh) counts as closed, so scans and
  // shortcuts keep working.
  const openDialog = dialog?.kind === 'line' && !editedLine ? null : dialog;

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  useEffect(() => {
    saveHeld(held);
  }, [held]);

  // One register, one cart: a cart (or held list) saved by another tab replaces this one.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) {
        dispatch({ type: 'replace', cart: loadCart() });
      } else if (event.key === HELD_STORAGE_KEY) {
        setHeld(loadHeld());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Names and prices follow edits made while the product sits in the cart, here or elsewhere.
  const productIds = cart.lines.map((line) => line.productId).join(',');
  const current = useLiveQuery(
    () => (productIds === '' ? [] : db.products.bulkGet(productIds.split(','))),
    [db, productIds],
  );
  useEffect(() => {
    if (current) {
      const products = current.filter((product) => product !== undefined);
      dispatch({ type: 'refresh', products });
    }
  }, [current]);

  function add(product: ProductRecord) {
    dispatch({ type: 'add', product });
  }

  async function handleScan(code: string) {
    if (openDialog !== null) {
      toast.show('Önce açık pencereyi kapatın.');
      return;
    }
    const product = await findProductByBarcode(db, code);
    if (product) {
      add(product);
    } else {
      setDialog({ kind: 'newProduct', barcode: code });
    }
  }

  async function pay(payments: Payment[], extra: { cashGiven?: Kurus; customerId?: string }) {
    setBusy(true);
    try {
      const sale = await checkout(db, {
        cart,
        deviceCode: settings.deviceCode,
        payments,
        at: new Date(),
        ...extra,
      });
      dispatch({ type: 'clear' });
      setDialog(null);
      toast.show(`Satış tamamlandı · ${sale.receiptNo}`);
      if (receiptSettings.printing && receiptSettings.autoPrint) {
        void printSale(sale);
      }
      void runner.run();
    } catch (error) {
      if (error instanceof StaleCartError) {
        dispatch({ type: 'renew' });
      }
      toast.show(checkoutErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // The cart keeps its id while held, so a resumed cart still sells only once.
  function hold() {
    if (!hasItems) {
      return;
    }
    if (held.length >= MAX_HELD) {
      toast.show(`En fazla ${MAX_HELD} sepet bekletilebilir.`);
      return;
    }
    setHeld(holdCart(held, cart, new Date()));
    dispatch({ type: 'clear' });
    toast.show('Sepet beklemeye alındı.');
  }

  async function resume(cartId: string) {
    // Another tab may have sold this cart while it sat here; checking out again would only
    // return that old sale, so drop it instead.
    if (await db.sales.get(cartId)) {
      setHeld((current) => current.filter((entry) => entry.cart.id !== cartId));
      setDialog(null);
      toast.show('Bu sepet zaten satılmış; bekleyenlerden çıkarıldı.');
      return;
    }
    const { cart: resumed, rest } = takeHeld(held, cartId);
    setHeld(hasItems ? holdCart(rest, cart, new Date()) : rest);
    dispatch({ type: 'replace', cart: resumed });
    setDialog(null);
  }

  // The receipt as it stands now: a reprint shows a later void or return.
  async function printSale(sale: SaleRecord) {
    const [status, customer] = await Promise.all([
      saleStatus(db, sale.id),
      sale.customerId ? db.customers.get(sale.customerId) : undefined,
    ]);
    const model = buildReceipt(sale, {
      ...receiptContext(settings, receiptSettings),
      customerName: customer?.name,
      status: { voided: status.voided, returnedAny: status.returned.size > 0 },
    });
    printReceipt(model, receiptSettings.paperWidth);
  }

  function saveSettings(next: ReceiptSettings) {
    saveReceiptSettings(next);
    setReceiptSettings(next);
    setDialog({ kind: 'receipts' });
  }

  function finish(message: string) {
    setDialog(null);
    toast.show(message);
    void runner.run();
  }

  useBarcodeScanner((code) => void handleScan(code));
  useShortcuts(
    {
      F1: () => searchRef.current?.focus(),
      F2: () => {
        if (hasItems) setDialog({ kind: 'cash' });
      },
      F4: () => {
        if (hasItems) setDialog({ kind: 'card' });
      },
      F8: () => {
        if (hasItems) hold();
        else if (held.length > 0) setDialog({ kind: 'held' });
      },
      F9: () => setDialog({ kind: 'receipts' }),
    },
    openDialog === null,
  );

  const close = () => setDialog(null);
  const paymentMethod = dialog?.kind === 'cash' || dialog?.kind === 'card' ? dialog.kind : null;

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        activeNav="pos"
        cart={
          <CartPanel
            cart={cart}
            dispatch={dispatch}
            onPay={(method) => setDialog({ kind: method })}
            onEditLine={(productId) => setDialog({ kind: 'line', productId })}
            onDiscount={() => setDialog({ kind: 'discount' })}
          />
        }
      >
        <ProductPanel
          onAdd={add}
          onNewProduct={(barcode) => setDialog({ kind: 'newProduct', barcode })}
          onScan={(code) => void handleScan(code)}
          searchRef={searchRef}
        />
        <div className="mt-auto flex flex-wrap gap-2">
          <Button kbd="F8" disabled={!hasItems} onClick={hold}>
            Beklet
          </Button>
          <Button disabled={held.length === 0} onClick={() => setDialog({ kind: 'held' })}>
            {`Bekleyenler (${held.length})`}
          </Button>
          <Button kbd="F9" onClick={() => setDialog({ kind: 'receipts' })}>
            Son fişler
          </Button>
        </div>
      </AppShell>

      {paymentMethod ? (
        <PaymentDialog
          open
          method={paymentMethod}
          total={cartTotals(cart).total}
          busy={busy}
          onClose={close}
          onConfirm={(cashGiven) => void pay(singlePayment(cart, paymentMethod), { cashGiven })}
        />
      ) : null}
      {dialog?.kind === 'split' ? (
        <SplitPaymentDialog
          open
          total={cartTotals(cart).total}
          busy={busy}
          onClose={close}
          onConfirm={({ payments, cashGiven, customerId }) =>
            void pay(payments, { cashGiven, customerId })
          }
        />
      ) : null}
      {dialog?.kind === 'discount' ? (
        <DiscountDialog open cart={cart} dispatch={dispatch} onClose={close} />
      ) : null}
      {editedLine ? (
        <LineDialog open line={editedLine} dispatch={dispatch} onClose={close} />
      ) : null}
      {dialog?.kind === 'credit' ? (
        <CustomerPicker
          open
          busy={busy}
          onClose={close}
          onPick={(customer) =>
            void pay(singlePayment(cart, 'credit'), { customerId: customer.id })
          }
        />
      ) : null}
      {dialog?.kind === 'newProduct' ? (
        <NewProductDialog
          open
          barcode={dialog.barcode}
          onClose={close}
          onCreated={(product) => {
            add(product);
            close();
          }}
        />
      ) : null}
      {dialog?.kind === 'held' ? (
        <HeldCartsDialog
          open
          held={held}
          onClose={close}
          onResume={(cartId) => void resume(cartId)}
        />
      ) : null}
      {dialog?.kind === 'receipts' ? (
        <ReceiptsDialog
          open
          settings={receiptSettings}
          onPrint={(sale) => void printSale(sale)}
          onSettings={() => setDialog({ kind: 'receiptSettings' })}
          onClose={close}
          onReturn={(sale) => setDialog({ kind: 'return', sale })}
          onVoid={(sale) => setDialog({ kind: 'void', sale })}
        />
      ) : null}
      {dialog?.kind === 'void' ? (
        <VoidDialog
          open
          sale={dialog.sale}
          onClose={() => setDialog({ kind: 'receipts' })}
          onVoided={() => finish(`Satış iptal edildi · ${dialog.sale.receiptNo}`)}
        />
      ) : null}
      {dialog?.kind === 'return' ? (
        <ReturnDialog
          open
          sale={dialog.sale}
          onClose={() => setDialog({ kind: 'receipts' })}
          onReturned={(record) =>
            finish(
              `İade kaydedildi · ${formatTRY(record.amount)} · ${record.refunds
                .map((refund) => `${PAYMENT_LABELS[refund.method]} ${formatTRY(refund.amount)}`)
                .join(' + ')}`,
            )
          }
        />
      ) : null}
      {dialog?.kind === 'receiptSettings' ? (
        <ReceiptSettingsDialog
          open
          settings={receiptSettings}
          marketName={settings.marketName}
          onClose={() => setDialog({ kind: 'receipts' })}
          onSave={saveSettings}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}
