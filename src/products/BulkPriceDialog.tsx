import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { bulkUpdatePrices, changedPrice, unknownBuyPrice, type PriceChange } from './bulkPrice';

export type BulkPriceDialogProps = {
  open: boolean;
  /** The products listed on the screen; only these change. */
  products: readonly ProductRecord[];
  onClose(): void;
  onDone(message: string): void;
};

const PREVIEW_COUNT = 5;
const PERCENT = /^\d+(?:[.,]\d)?$/;

const TARGETS = [
  { value: 'sellPrice', label: 'Satış fiyatı' },
  { value: 'buyPrice', label: 'Alış fiyatı' },
] as const;
const DIRECTIONS = [
  { value: 1, label: 'Artır' },
  { value: -1, label: 'Azalt' },
] as const;
const KINDS = [
  { value: 'percent', label: '%' },
  { value: 'amount', label: '₺' },
] as const;
const STEPS = [
  { value: 0, label: 'Yok' },
  { value: 25, label: '0,25' },
  { value: 50, label: '0,50' },
  { value: 100, label: '1,00' },
] as const;

type Outcome =
  | { error: string }
  | {
      change: PriceChange;
      prices: { product: ProductRecord; next: number }[];
      /** Products left as they are because their buy price is unknown. */
      unknown: number;
    };

/** Raises or lowers one price of the listed products by a percentage or an amount, rounded. */
export function BulkPriceDialog({
  open,
  products,
  onClose,
  onDone,
}: BulkPriceDialogProps): JSX.Element {
  const { db } = useData();
  const [target, setTarget] = useState<PriceChange['target']>('sellPrice');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [by, setBy] = useState<PriceChange['by']>('percent');
  const [amount, setAmount] = useState('');
  const [roundTo, setRoundTo] = useState<PriceChange['roundTo']>(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const outcome = workOut(products, { target, direction, by, amount, roundTo });
  const changing =
    'prices' in outcome
      ? outcome.prices.filter(({ product, next }) => next !== product[target])
      : [];

  async function apply() {
    if (!('change' in outcome)) {
      return;
    }
    setBusy(true);
    try {
      const ids = changing.map(({ product }) => product.id);
      const count = await bulkUpdatePrices(db, ids, outcome.change, new Date());
      onDone(`${count} ürünün fiyatı değişti.`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Toplu fiyat değişikliği"
      description={`Listedeki ${products.length} ürün`}
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup
          legend="Hangi fiyat"
          name="target"
          options={TARGETS}
          value={target}
          onChange={(next) => setTarget(next)}
        />
        <ChoiceGroup
          legend="Değişim"
          name="direction"
          options={DIRECTIONS}
          value={direction}
          onChange={(next) => setDirection(next)}
        />
        <ChoiceGroup
          legend="Nasıl"
          name="by"
          options={KINDS}
          value={by}
          onChange={(next) => setBy(next)}
        />
        <TextField
          label="Miktar"
          hint={by === 'percent' ? 'Yüzde, örnek: 10 ya da 12,5' : 'Tutar, örnek: 2,50'}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={'error' in outcome && amount.trim() !== '' ? outcome.error : undefined}
          onChange={(event) => setAmount(event.target.value)}
        />
        <ChoiceGroup
          legend="Yuvarla"
          name="roundTo"
          options={STEPS}
          value={roundTo}
          onChange={(next) => setRoundTo(next)}
        />
        {'prices' in outcome && changing.length > 0 ? (
          <ul className="flex flex-col gap-1 text-text-2">
            {changing.slice(0, PREVIEW_COUNT).map(({ product, next }) => (
              <li key={product.id}>
                {`${product.name}: ${formatTRY(product[target])} → ${formatTRY(next)}`}
              </li>
            ))}
          </ul>
        ) : null}
        {'unknown' in outcome && outcome.unknown > 0 ? (
          <p className="text-sm text-text-2">{`Alış fiyatı bilinmeyen ${outcome.unknown} ürün değişmez.`}</p>
        ) : null}
        {failed ? (
          <p role="alert" className="font-medium text-danger">
            Fiyatlar değiştirilemedi. Hiçbir fiyat değişmedi.
          </p>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          disabled={busy || changing.length === 0}
          onClick={() => void apply()}
        >
          {`${changing.length} ürünün fiyatını değiştir`}
        </Button>
      </div>
    </Dialog>
  );
}

/** The change the form describes and each product's new price, or why there is none. */
function workOut(
  products: readonly ProductRecord[],
  form: {
    target: PriceChange['target'];
    direction: 1 | -1;
    by: PriceChange['by'];
    amount: string;
    roundTo: PriceChange['roundTo'];
  },
): Outcome {
  const text = form.amount.trim();
  let size: number;
  if (form.by === 'percent') {
    if (!PERCENT.test(text)) {
      return { error: 'Geçerli bir miktar girin.' };
    }
    const [whole = '0', tenth = '0'] = text.split(/[.,]/);
    size = Number(whole) * 10 + Number(tenth);
  } else {
    try {
      size = parseTRY(text);
    } catch {
      return { error: 'Geçerli bir miktar girin.' };
    }
  }
  const change: PriceChange = {
    target: form.target,
    by: form.by,
    value: form.direction * size,
    roundTo: form.roundTo,
  };
  const prices: { product: ProductRecord; next: number }[] = [];
  let unknown = 0;
  for (const product of products) {
    if (unknownBuyPrice(product, form.target)) {
      unknown += 1;
      continue;
    }
    let next: number;
    try {
      next = changedPrice(product[form.target], change);
    } catch {
      return {
        error: `Fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir: ${product.name}.`,
      };
    }
    // Rounding or a large decrease could leave a priced product free at the register.
    if (next === 0 && product[form.target] > 0) {
      return { error: `Bu değişiklik ${product.name} ürününün fiyatını ₺0 yapar.` };
    }
    prices.push({ product, next });
  }
  return { change, prices, unknown };
}
