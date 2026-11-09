import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { normalizeForSearch } from '@/data/text';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { formatTRY } from '@/domain/money';
import { printView } from '@/pos/printView';
import { LabelSheet } from './LabelSheet';
import { expandLabels, MAX_LABELS, priceChangedOn, type LabelItem, type LabelKind } from './labels';

const KINDS: readonly { value: LabelKind; label: string }[] = [
  { value: 'shelf', label: 'Raf etiketi' },
  { value: 'barcode', label: 'Barkod etiketi' },
];

const PER_SHEET = 24;
const MAX_MATCHES = 8;

/**
 * "Etiket yazdır": pick the products, how many labels of each and the kind, then print them on
 * A4 label sheets. The products whose price changed today are one press away.
 */
export function LabelDialog({
  open,
  onClose,
  print,
}: {
  open: boolean;
  onClose(): void;
  /** The browser's print window; a test stands in for it. */
  print?: () => void;
}): JSX.Element {
  const { db } = useData();
  const { cutoffMinutes } = useMarketSettings();
  const today = businessDate(new Date(), { cutoffMinutes });
  const [kind, setKind] = useState<LabelKind>('shelf');
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<{ product: ProductRecord; copies: string }[]>([]);

  const changedToday = useLiveQuery(() => priceChangedOn(db, today), [db, today]) ?? [];
  const needle = normalizeForSearch(term);
  const matches =
    useLiveQuery(
      () =>
        needle === ''
          ? []
          : db.products
              .filter(
                (product) =>
                  !product.deletedAt &&
                  (normalizeForSearch(product.name).includes(needle) ||
                    product.barcode === term.trim().toUpperCase()),
              )
              .limit(MAX_MATCHES)
              .toArray(),
      [db, needle, term],
    ) ?? [];

  function add(products: readonly ProductRecord[]) {
    setItems((current) => {
      const have = new Set(current.map((item) => item.product.id));
      return [
        ...current,
        ...products
          .filter((product) => !have.has(product.id))
          .map((product) => ({ product, copies: '1' })),
      ];
    });
  }

  const picked: LabelItem[] = items.map(({ product, copies }) => ({
    product,
    copies: Math.max(0, Math.floor(Number(copies) || 0)),
  }));
  const labels = expandLabels(picked);
  const sheets = Math.ceil(labels.length / PER_SHEET);

  function printLabels() {
    printView(
      <LabelSheet kind={kind} products={labels} printedOn={today} />,
      () => '@page { size: A4; margin: 0; }',
      print,
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Etiket yazdır"
      description="A4 etiket kâğıdına, sayfada 3 × 8 (70 × 37 mm)."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup<LabelKind>
          legend="Etiket türü"
          name="labelKind"
          options={KINDS}
          value={kind}
          onChange={(next) => setKind(next)}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[1_1_220px]">
            <TextField
              label="Ürün ekle"
              placeholder="Ad ya da barkod"
              autoComplete="off"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <Button disabled={changedToday.length === 0} onClick={() => add(changedToday)}>
            {`Bugün fiyatı değişenler (${changedToday.length})`}
          </Button>
        </div>
        {matches.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {matches.map((product) => (
              <li key={product.id}>
                <Button
                  aria-label={`Ekle: ${product.name}`}
                  onClick={() => {
                    add([product]);
                    setTerm('');
                  }}
                >
                  {`${product.name} · ${formatTRY(product.sellPrice)}`}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {items.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
            {items.map(({ product, copies }) => (
              <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 font-medium break-words">{product.name}</span>
                <input
                  aria-label={`Adet: ${product.name}`}
                  inputMode="numeric"
                  value={copies}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((item) =>
                        item.product.id === product.id
                          ? { ...item, copies: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className="min-h-11 w-16 rounded-control border border-line-strong bg-surface px-2 text-right"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Çıkar: ${product.name}`}
                  icon={<X aria-hidden="true" size={18} />}
                  onClick={() =>
                    setItems((current) => current.filter((item) => item.product.id !== product.id))
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-2">Etiket basılacak ürünleri ekleyin.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-sm text-text-2">
            {`${labels.length} etiket · ${sheets} sayfa`}
            {labels.length === MAX_LABELS ? ` (en fazla ${MAX_LABELS})` : ''}
          </p>
          <Button variant="primary" disabled={labels.length === 0} onClick={printLabels}>
            Yazdır
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
