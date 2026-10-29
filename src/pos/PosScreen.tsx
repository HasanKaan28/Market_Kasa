import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useReducer, useRef, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { findProductByBarcode } from '@/data/products';
import type { PaymentMethod, ProductRecord } from '@/data/types';
import { ToastRegion, useToast } from '@/design';
import type { Kurus } from '@/domain/money';
import { CART_STORAGE_KEY, cartReducer, cartTotals, loadCart, saveCart } from './cart';
import { CartPanel } from './CartPanel';
import { checkout, checkoutErrorMessage, StaleCartError } from './checkout';
import { CustomerPicker } from './CustomerPicker';
import { useBarcodeScanner, useShortcuts } from './keyboard';
import { NewProductDialog } from './NewProductDialog';
import { PaymentDialog } from './PaymentDialog';
import { ProductPanel } from './ProductPanel';

type OpenDialog =
  | { kind: 'cash' | 'card' }
  | { kind: 'credit' }
  | { kind: 'newProduct'; barcode?: string }
  | null;

/** The register: search and scan on the left, the cart and payment on the right. */
export function PosScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const [cart, dispatch] = useReducer(cartReducer, undefined, () => loadCart());
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const hasItems = cart.lines.length > 0;

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  // One register, one cart: a cart saved by another tab replaces this one.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) {
        dispatch({ type: 'replace', cart: loadCart() });
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
    if (dialog !== null) {
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

  async function pay(method: PaymentMethod, extra: { cashGiven?: Kurus; customerId?: string }) {
    setBusy(true);
    try {
      const sale = await checkout(db, {
        cart,
        deviceCode: settings.deviceCode,
        method,
        at: new Date(),
        ...extra,
      });
      dispatch({ type: 'clear' });
      setDialog(null);
      toast.show(`Satış tamamlandı · ${sale.receiptNo}`);
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
    },
    dialog === null,
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
          <CartPanel cart={cart} dispatch={dispatch} onPay={(method) => setDialog({ kind: method })} />
        }
      >
        <ProductPanel
          onAdd={add}
          onNewProduct={(barcode) => setDialog({ kind: 'newProduct', barcode })}
          searchRef={searchRef}
        />
      </AppShell>

      {paymentMethod ? (
        <PaymentDialog
          open
          method={paymentMethod}
          total={cartTotals(cart).total}
          busy={busy}
          onClose={close}
          onConfirm={(cashGiven) => void pay(paymentMethod, { cashGiven })}
        />
      ) : null}
      {dialog?.kind === 'credit' ? (
        <CustomerPicker
          open
          onClose={close}
          onPick={(customer) => void pay('credit', { customerId: customer.id })}
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
      <ToastRegion message={toast.message} />
    </>
  );
}
