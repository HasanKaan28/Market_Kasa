import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useState, type JSX, type KeyboardEvent } from 'react';
import { useData } from '@/app/appData';
import { findProductByBarcode, productsById, searchProducts } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import type { ProductRecord } from '@/data/types';
import { Button, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatPriceInput, formatStock } from '@/pos/format';
import { CameraButton } from '@/pos/CameraButton';
import { looksLikeBarcode, useBarcodeScanner } from '@/pos/keyboard';
import { ProductFormDialog } from '@/products/ProductFormDialog';
import {
  addProduct,
  DELETED_PRODUCT_LINE,
  draftLineCost,
  EMPTY_DRAFT,
  loadDraft,
  readDraftLines,
  saveDraft,
  shownPrice,
  type DraftLine,
  type ReceiptDraft,
} from './receiptDraft';
import { useDraftProducts } from './useDraftProducts';

const SEARCH_LIMIT = 8;

type LineField = 'qty' | 'buyPrice' | 'sellPrice';
type PriceField = 'buyPrice' | 'sellPrice';

export type GoodsReceiptProps = {
  /** Called with the message to show once a receipt or a new product is saved. */
  onDone(message: string): void;
};

/**
 * Goods coming in: scan or search each product, type how many came and at what price, and save
 * them as one receipt. The draft is kept on this device until it is saved.
 */
export function GoodsReceipt({ onDone }: GoodsReceiptProps): JSX.Element {
  const { db, settings, runner } = useData();
  const [draft, setDraft] = useState<ReceiptDraft>(() => loadDraft());
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [newBarcode, setNewBarcode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const term = query.trim();
  const results = useLiveQuery(
    () => (term === '' ? [] : searchProducts(db, term, SEARCH_LIMIT)),
    [db, term],
  );
  // The draft's products as they are now: their prices fill the boxes nobody typed in, and a
  // product deleted elsewhere is marked on its line before anyone tries to save.
  const live = useDraftProducts(draft.lines);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  function add(product: ProductRecord) {
    setDraft((current) => addProduct(current, product));
    setQuery('');
  }

  // A scanned code is always a barcode; typed text only when it looks like one, as at the register.
  async function addByBarcode(code: string, typed = false) {
    const product = await findProductByBarcode(db, code);
    if (product) {
      add(product);
    } else if (!typed || looksLikeBarcode(code)) {
      setNewBarcode(code);
    }
  }

  // While the new product form is open, scans belong to its barcode box.
  useBarcodeScanner((code) => {
    if (newBarcode === undefined) {
      void addByBarcode(code);
    }
  });

  async function created(barcode: string, message: string) {
    setNewBarcode(undefined);
    onDone(message);
    const product = await findProductByBarcode(db, barcode);
    if (product) {
      add(product);
    }
  }

  // Only typed input reaches here: a scanner's Enter is taken by useBarcodeScanner first.
  function submitSearch(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && term !== '') {
      event.preventDefault();
      void addByBarcode(term, true);
    }
  }

  function setLine(productId: string, field: LineField, value: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.productId === productId ? { ...line, [field]: value } : line,
      ),
    }));
  }

  function remove(productId: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.productId !== productId),
    }));
  }

  async function save() {
    setBusy(true);
    setFailure(undefined);
    try {
      // Read again now: the products may have changed since the screen last drew them.
      const products = await productsById(
        db,
        draft.lines.map((line) => line.productId),
      );
      const read = readDraftLines(draft, products);
      setErrors(read.errors);
      if (read.errors.size > 0) {
        const names = draft.lines
          .filter((line) => read.errors.has(line.productId))
          .map((line) => products.get(line.productId)?.name ?? line.name);
        setFailure(`Mal kabul kaydedilmedi. Düzeltilecek satırlar: ${names.join(', ')}.`);
        return;
      }
      const purchase = await recordPurchase(
        db,
        { deviceCode: settings.deviceCode, lines: read.lines, note: draft.note },
        new Date(),
      );
      setDraft(EMPTY_DRAFT);
      onDone(`Mal kabul kaydedildi: ${purchase.lines.length} ürün, ${formatTRY(purchase.total)}.`);
      void runner.run();
    } catch {
      setFailure('Mal kabul kaydedilemedi. Hiçbir şey değişmedi.');
    } finally {
      setBusy(false);
    }
  }

  const rows = draft.lines.map((line) => {
    const product = live?.products.get(line.productId);
    const gone = live !== undefined && (!product || Boolean(product.deletedAt));
    return {
      line,
      product,
      cost: gone ? undefined : draftLineCost(line, product),
      error: errors.get(line.productId) ?? (gone ? DELETED_PRODUCT_LINE : undefined),
    };
  });
  const total = rows.reduce<number>((sum, row) => sum + (row.cost ?? 0), 0);

  return (
    <section aria-label="Mal kabul" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <TextField
          label="Ürün ara ya da okut"
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={submitSearch}
        />
        <div>
          <CameraButton onScan={(code) => void addByBarcode(code)} />
        </div>
        {results && results.length > 0 ? (
          <ul aria-label="Arama sonuçları" className="flex flex-wrap gap-2">
            {results.map((product) => (
              <li key={product.id}>
                <Button onClick={() => add(product)}>{product.name}</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-text-2">Gelen ürünleri okutun ya da arayın; burada listelenir.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ line, product, cost, error }) => (
            <li key={line.productId}>
              <ReceiptLine
                line={line}
                product={product}
                stockMilli={live?.stock.get(line.productId) ?? 0}
                cost={cost}
                error={error}
                onChange={(field, value) => setLine(line.productId, field, value)}
                onRemove={() => remove(line.productId)}
              />
            </li>
          ))}
        </ul>
      )}

      <TextField
        label="Not"
        hint="İrsaliye numarası, tedarikçi ya da başka bir not."
        autoComplete="off"
        value={draft.note}
        onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
      />
      <p className="font-semibold">{`Toplam: ${formatTRY(total)}`}</p>
      {failure ? (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      ) : null}
      <div>
        <Button
          variant="primary"
          size="lg"
          disabled={busy || draft.lines.length === 0}
          onClick={() => void save()}
        >
          Mal kabulü kaydet
        </Button>
      </div>

      {newBarcode !== undefined ? (
        <ProductFormDialog
          open
          barcode={newBarcode}
          askOpeningStock={false}
          onClose={() => setNewBarcode(undefined)}
          onSaved={(message) => void created(newBarcode, message)}
        />
      ) : null}
    </section>
  );
}

function ReceiptLine({
  line,
  product,
  stockMilli,
  cost,
  error,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  /** The product as it is now; deleted ones too, so the line keeps its name. */
  product: ProductRecord | undefined;
  stockMilli: number;
  cost: number | undefined;
  error: string | undefined;
  onChange(field: LineField, value: string): void;
  onRemove(): void;
}): JSX.Element {
  const name = product?.name ?? line.name;
  const unit = product?.unit ?? line.unit;
  return (
    <div
      role="group"
      aria-label={name}
      className="flex flex-col gap-2 rounded-control border border-line p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-medium break-words">{name}</p>
        <span className="text-sm text-text-2">{`Stok: ${formatStock(stockMilli, unit)}`}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Çıkar: ${name}`}
          icon={<X aria-hidden="true" size={18} />}
          onClick={onRemove}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <TextField
          label="Miktar"
          hint={unit === 'kg' ? 'Kilogram' : 'Adet'}
          inputMode="decimal"
          autoComplete="off"
          value={line.qty}
          onChange={(event) => onChange('qty', event.target.value)}
        />
        <TextField
          label="Alış fiyatı"
          inputMode="decimal"
          autoComplete="off"
          value={shownPrice(line, product, 'buyPrice')}
          placeholder={keptPrice(product, 'buyPrice')}
          onChange={(event) => onChange('buyPrice', event.target.value)}
        />
        <TextField
          label="Satış fiyatı"
          inputMode="decimal"
          autoComplete="off"
          value={shownPrice(line, product, 'sellPrice')}
          placeholder={keptPrice(product, 'sellPrice')}
          onChange={(event) => onChange('sellPrice', event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {cost !== undefined ? (
        <p className="text-sm text-text-2">{`Tutar: ${formatTRY(cost)}`}</p>
      ) : null}
    </div>
  );
}

/** An emptied price box shows, greyed, the price the product keeps. */
function keptPrice(product: ProductRecord | undefined, field: PriceField): string | undefined {
  return product && product[field] > 0 ? formatPriceInput(product[field]) : undefined;
}
