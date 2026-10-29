import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useState, type JSX, type KeyboardEvent } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { countsNeedingCheck, recordCount } from '@/data/counts';
import { findProductByBarcode, productsById, searchProducts } from '@/data/products';
import type { ProductRecord, ProductUnit } from '@/data/types';
import { Button, TextField } from '@/design';
import { formatQtyInput, formatStock } from '@/pos/format';
import { CameraButton } from '@/pos/CameraButton';
import { looksLikeBarcode, useBarcodeScanner } from '@/pos/keyboard';
import {
  addToCount,
  countProduct,
  EMPTY_COUNT,
  loadCountDraft,
  readCounted,
  readCountLines,
  saveCountDraft,
  type CountDraft,
  type CountDraftLine,
} from './countDraft';
import { DELETED_PRODUCT_LINE } from './receiptDraft';
import { useDraftProducts } from './useDraftProducts';

const SEARCH_LIMIT = 8;
const CHECK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StockCountProps = {
  /** Called with the message to show once the count is saved. */
  onDone(message: string): void;
};

/**
 * Counting the shelf: scan or search each product, type what is there, and save the count. Each
 * difference moves the stock. Counts that later movements no longer add up to are listed first,
 * to be counted again. The draft is kept on this device until it is saved.
 */
export function StockCount({ onDone }: StockCountProps): JSX.Element {
  const { db, settings, runner } = useData();
  const { staff } = useSession();
  const [draft, setDraft] = useState<CountDraft>(() => loadCountDraft());
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string>();
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const term = query.trim();
  const results = useLiveQuery(
    () => (term === '' ? [] : searchProducts(db, term, SEARCH_LIMIT)),
    [db, term],
  );
  const live = useDraftProducts(draft.lines);
  const checks = useLiveQuery(
    () => countsNeedingCheck(db, new Date(Date.now() - CHECK_DAYS * DAY_MS)),
    [db],
  );

  useEffect(() => {
    saveCountDraft(draft);
  }, [draft]);

  function add(product: Pick<ProductRecord, 'id' | 'name' | 'unit'>) {
    setDraft((current) => addToCount(current, product));
    setQuery('');
  }

  // A scanned code is always a barcode; typed text only when it looks like one. Says what it
  // counted, for the camera, whose window hides this screen.
  async function scanned(code: string, typed = false): Promise<string | undefined> {
    const product = await findProductByBarcode(db, code);
    if (product) {
      const line = draft.lines.find((current) => current.productId === product.id);
      setDraft((current) => countProduct(current, product));
      setNotice(undefined);
      setQuery('');
      if (product.unit !== 'piece') {
        return `${product.name}: miktarı yazın`;
      }
      const before = line ? (readCounted(line.counted, 'piece') ?? 0) : 0;
      return `${product.name}: ${formatQtyInput(before + 1000)} adet`;
    }
    if (!typed || looksLikeBarcode(code)) {
      setNotice('Bu barkod kayıtlı değil.');
      return 'Bu barkod kayıtlı değil.';
    }
    return undefined;
  }

  useBarcodeScanner((code) => void scanned(code));

  // Only typed input reaches here: a scanner's Enter is taken by useBarcodeScanner first.
  function submitSearch(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && term !== '') {
      event.preventDefault();
      void scanned(term, true);
    }
  }

  function setCounted(productId: string, counted: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.productId === productId ? { ...line, counted } : line,
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
      const read = readCountLines(draft, products);
      setErrors(read.errors);
      if (read.errors.size > 0) {
        const names = draft.lines
          .filter((line) => read.errors.has(line.productId))
          .map((line) => products.get(line.productId)?.name ?? line.name);
        setFailure(`Sayım kaydedilmedi. Düzeltilecek satırlar: ${names.join(', ')}.`);
        return;
      }
      const count = await recordCount(
        db,
        {
          deviceCode: settings.deviceCode,
          staffId: staff?.id,
          lines: read.lines,
          note: draft.note,
        },
        new Date(),
      );
      const differing = count.lines.filter((line) => line.countedMilli !== line.expectedMilli);
      setDraft(EMPTY_COUNT);
      onDone(`Sayım kaydedildi: ${count.lines.length} ürün, ${differing.length} farklı.`);
      void runner.run();
    } catch {
      setFailure('Sayım kaydedilemedi. Hiçbir şey değişmedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Sayım" className="flex flex-col gap-4">
      {checks && checks.length > 0 ? (
        <section
          aria-label="Kontrol gerekli"
          className="flex flex-col gap-2 rounded-control border border-warning bg-warning-bg p-3"
        >
          <h2 className="font-semibold">Kontrol gerekli</h2>
          <p className="text-sm text-text-2">
            Sayımdan sonra gelen hareketler bu sayımları tutmaz yaptı. Ürünü yeniden sayın.
          </p>
          <ul className="flex flex-col gap-2">
            {checks.map(({ count, line, expectedNowMilli }) => (
              <li
                key={`${count.id}:${line.productId}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {`${line.name}: sayımda ${formatStock(line.knownBeforeMilli, line.unit)} beklendi, şimdi ${formatStock(expectedNowMilli, line.unit)} görünüyor.`}
                </span>
                <Button
                  aria-label={`Yeniden say: ${line.name}`}
                  onClick={() => add({ id: line.productId, name: line.name, unit: line.unit })}
                >
                  Yeniden say
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
          <CameraButton continuous onScan={(code) => scanned(code)} />
        </div>
        {notice ? (
          <p role="status" className="text-sm font-medium text-danger">
            {notice}
          </p>
        ) : null}
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
        <p className="text-text-2">Saydığınız ürünleri okutun ya da arayın; burada listelenir.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {draft.lines.map((line) => {
            const product = live?.products.get(line.productId);
            const gone = live !== undefined && (!product || Boolean(product.deletedAt));
            return (
              <li key={line.productId}>
                <CountLineView
                  line={line}
                  name={product?.name ?? line.name}
                  unit={product?.unit ?? line.unit}
                  expectedMilli={live ? (live.stock.get(line.productId) ?? 0) : undefined}
                  error={errors.get(line.productId) ?? (gone ? DELETED_PRODUCT_LINE : undefined)}
                  onChange={(counted) => setCounted(line.productId, counted)}
                  onRemove={() => remove(line.productId)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <TextField
        label="Not"
        hint="Hangi raf, kim saydı ya da başka bir not."
        autoComplete="off"
        value={draft.note}
        onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
      />
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
          Sayımı kaydet
        </Button>
      </div>
    </section>
  );
}

function CountLineView({
  line,
  name,
  unit,
  expectedMilli,
  error,
  onChange,
  onRemove,
}: {
  line: CountDraftLine;
  name: string;
  unit: ProductUnit;
  /** The stock now; undefined while it is read. */
  expectedMilli: number | undefined;
  error: string | undefined;
  onChange(counted: string): void;
  onRemove(): void;
}): JSX.Element {
  const counted = line.counted.trim() === '' ? null : readCounted(line.counted, unit);
  const difference =
    expectedMilli !== undefined && counted !== null ? counted - expectedMilli : undefined;
  return (
    <div
      role="group"
      aria-label={name}
      className="flex flex-col gap-2 rounded-control border border-line p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-medium break-words">{name}</p>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Çıkar: ${name}`}
          icon={<X aria-hidden="true" size={18} />}
          onClick={onRemove}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3 sm:items-center">
        <TextField
          label="Sayılan"
          hint={unit === 'kg' ? 'Kilogram' : 'Adet'}
          inputMode="decimal"
          autoComplete="off"
          value={line.counted}
          onChange={(event) => onChange(event.target.value)}
        />
        {expectedMilli === undefined ? null : (
          <p className="text-sm text-text-2">{`Beklenen: ${formatStock(expectedMilli, unit)}`}</p>
        )}
        {difference === undefined ? null : (
          <p className={`text-sm font-medium ${difference === 0 ? 'text-text-2' : 'text-warning'}`}>
            {difference === 0
              ? 'Fark yok'
              : `Fark: ${difference > 0 ? '+' : ''}${formatStock(difference, unit)}`}
          </p>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
