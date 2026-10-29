import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useState, type JSX, type KeyboardEvent } from 'react';
import { useData } from '@/app/appData';
import { findProductByBarcode, searchProducts } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import type { ProductRecord } from '@/data/types';
import { Button, TextField } from '@/design';
import { formatTRY, parseTRY } from '@/domain/money';
import { lineTotal } from '@/domain/pricing';
import { formatStock, parseQuantity } from '@/pos/format';
import { useBarcodeScanner } from '@/pos/keyboard';
import { ProductFormDialog } from '@/products/ProductFormDialog';
import {
  addProduct,
  EMPTY_DRAFT,
  loadDraft,
  readDraftLines,
  saveDraft,
  type DraftLine,
  type ReceiptDraft,
} from './receiptDraft';

const SEARCH_LIMIT = 8;

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
  const ids = draft.lines.map((line) => line.productId);
  const idKey = ids.join(',');
  const stock = useLiveQuery(async () => {
    const levels = await db.stockLevels.where('productId').anyOf(idKey.split(',')).toArray();
    return new Map(levels.map((level) => [level.productId, level.qtyMilli]));
  }, [db, idKey]);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  function add(product: ProductRecord) {
    setDraft((current) => addProduct(current, product));
    setQuery('');
  }

  async function addByBarcode(code: string) {
    const product = await findProductByBarcode(db, code);
    if (product) {
      add(product);
    } else {
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
      void addByBarcode(term);
    }
  }

  function setLine(productId: string, field: 'qty' | 'buyPrice' | 'sellPrice', value: string) {
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
    const read = readDraftLines(draft);
    setErrors(read.errors);
    if (read.errors.size > 0 || read.lines.length === 0) {
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
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

  const costs = draft.lines.map(costOf);
  const total = costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);

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

      {draft.lines.length === 0 ? (
        <p className="text-text-2">Gelen ürünleri okutun ya da arayın; burada listelenir.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {draft.lines.map((line, index) => (
            <li key={line.productId}>
              <ReceiptLine
                line={line}
                stockMilli={stock?.get(line.productId) ?? 0}
                cost={costs[index]}
                error={errors.get(line.productId)}
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
          onClose={() => setNewBarcode(undefined)}
          onSaved={(message) => void created(newBarcode, message)}
        />
      ) : null}
    </section>
  );
}

function ReceiptLine({
  line,
  stockMilli,
  cost,
  error,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  stockMilli: number;
  cost: number | undefined;
  error: string | undefined;
  onChange(field: 'qty' | 'buyPrice' | 'sellPrice', value: string): void;
  onRemove(): void;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label={line.name}
      className="flex flex-col gap-2 rounded-control border border-line p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-medium break-words">{line.name}</p>
        <span className="text-sm text-text-2">{`Stok: ${formatStock(stockMilli, line.unit)}`}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Çıkar: ${line.name}`}
          icon={<X aria-hidden="true" size={18} />}
          onClick={onRemove}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <TextField
          label="Miktar"
          hint={line.unit === 'kg' ? 'Kilogram' : 'Adet'}
          inputMode="decimal"
          autoComplete="off"
          value={line.qty}
          onChange={(event) => onChange('qty', event.target.value)}
        />
        <TextField
          label="Alış fiyatı"
          inputMode="decimal"
          autoComplete="off"
          value={line.buyPrice}
          onChange={(event) => onChange('buyPrice', event.target.value)}
        />
        <TextField
          label="Satış fiyatı"
          inputMode="decimal"
          autoComplete="off"
          value={line.sellPrice}
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

/** A line's cost when its quantity and buy price can be read; nothing otherwise. */
function costOf(line: DraftLine): number | undefined {
  const qtyMilli = parseQuantity(line.qty, line.unit);
  if (qtyMilli === null || line.buyPrice.trim() === '') {
    return undefined;
  }
  try {
    return lineTotal(qtyMilli, parseTRY(line.buyPrice));
  } catch {
    return undefined;
  }
}
