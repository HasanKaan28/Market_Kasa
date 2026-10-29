import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { listCategories } from '@/data/categories';
import { DuplicateBarcodeError } from '@/data/errors';
import { createProduct, deleteProduct, restoreProduct, updateProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, SelectField, TextField } from '@/design';
import { formatStock, UNIT_LABELS, VAT_OPTIONS } from '@/pos/format';
import { useBarcodeScanner } from '@/pos/keyboard';
import {
  draftOf,
  profitHint,
  readDraft,
  UNIT_OPTIONS,
  type DraftErrors,
  type ProductDraft,
} from './productForm';

export type ProductFormDialogProps = {
  open: boolean;
  /** The product to edit; without one the form adds a new product. */
  product?: ProductRecord;
  /** A scanned barcode for a new product. */
  barcode?: string;
  onClose(): void;
  /** Called with the message to show once the change is saved. */
  onSaved(message: string): void;
};

type Errors = DraftErrors & { form?: string };

/** Adds or edits a product with every field the catalogue keeps; also deletes and restores. */
export function ProductFormDialog({
  open,
  product,
  barcode,
  onClose,
  onSaved,
}: ProductFormDialogProps): JSX.Element {
  const { db } = useData();
  const [draft, setDraft] = useState(() => draftOf(product, barcode));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const categories = useLiveQuery(() => listCategories(db), [db]);
  const productId = product?.id;
  const stockMilli = useLiveQuery(
    () => (productId === undefined ? undefined : stockOf(db, productId)),
    [db, productId],
  );

  useBarcodeScanner((code) => {
    if (open) {
      set('barcode', code);
    }
  });

  function set<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // A category deleted elsewhere is shown, and saved, as none. Until the list loads, the stored
  // category stands, so a quick save never drops it.
  const categoryId =
    categories === undefined || categories.some((category) => category.id === draft.categoryId)
      ? draft.categoryId
      : '';

  async function run(action: () => Promise<string>, failure: string) {
    setBusy(true);
    try {
      onSaved(await action());
    } catch (error) {
      setErrors(
        error instanceof DuplicateBarcodeError
          ? { barcode: `Bu barkod “${error.holderName}” ürününde kayıtlı.` }
          : { form: failure },
      );
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = readDraft({ ...draft, categoryId });
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    void run(async () => {
      if (product) {
        await updateProduct(db, product.id, read.fields, new Date());
        return 'Ürün kaydedildi.';
      }
      await createProduct(db, read.fields, new Date(), {
        openingStockMilli: read.openingStockMilli,
      });
      return 'Ürün eklendi.';
    }, 'Ürün kaydedilemedi.');
  }

  const deleted = Boolean(product?.deletedAt);
  const categoryOptions = [
    { value: '', label: 'Kategorisiz' },
    ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={product ? 'Ürünü düzenle' : 'Yeni ürün'}
    >
      {product && deleted ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-bg p-3">
          <p className="font-medium">Bu ürün silinmiş.</p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await restoreProduct(db, product.id, new Date());
                return 'Ürün geri getirildi.';
              }, 'Ürün geri getirilemedi.')
            }
          >
            Geri getir
          </Button>
        </div>
      ) : null}
      <form noValidate className="flex flex-col gap-4" onSubmit={save}>
        <TextField
          label="Barkod"
          hint="Okutun ya da yazın; boş bırakılabilir."
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          value={draft.barcode}
          error={errors.barcode}
          onChange={(event) => set('barcode', event.target.value)}
        />
        <TextField
          label="Ürün adı"
          autoFocus
          autoComplete="off"
          value={draft.name}
          error={errors.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <SelectField
          label="Kategori"
          value={categoryId}
          options={categoryOptions}
          onChange={(event) => set('categoryId', event.target.value)}
        />
        <ChoiceGroup
          legend="Birim"
          name="unit"
          options={UNIT_OPTIONS}
          value={draft.unit}
          onChange={(unit) => set('unit', unit)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Satış fiyatı"
            hint="Örnek: 12,50"
            inputMode="decimal"
            autoComplete="off"
            value={draft.sellPrice}
            error={errors.sellPrice}
            onChange={(event) => set('sellPrice', event.target.value)}
          />
          <TextField
            label="Alış fiyatı"
            hint={profitHint(draft) ?? 'Boş bırakılabilir.'}
            inputMode="decimal"
            autoComplete="off"
            value={draft.buyPrice}
            error={errors.buyPrice}
            onChange={(event) => set('buyPrice', event.target.value)}
          />
        </div>
        <ChoiceGroup
          legend="KDV oranı"
          name="vatRate"
          options={VAT_OPTIONS}
          value={draft.vatRate}
          onChange={(rate) => set('vatRate', rate)}
        />
        <TextField
          label="Kritik stok"
          hint="Stok bu miktara inince uyarı verilir. Boş bırakılırsa uyarı yok."
          inputMode="decimal"
          autoComplete="off"
          value={draft.criticalLevel}
          error={errors.criticalLevel}
          onChange={(event) => set('criticalLevel', event.target.value)}
        />
        {product ? (
          <div className="flex flex-col gap-1">
            <p className="font-medium">{`Stok: ${formatStock(stockMilli ?? 0, product.unit)}`}</p>
            <p className="text-sm text-muted">Stok, mal kabul ve sayımla değişir.</p>
          </div>
        ) : (
          <TextField
            label="Başlangıç stoğu"
            hint={`Rafta şu an kaç ${UNIT_LABELS[draft.unit]} var?`}
            inputMode="decimal"
            autoComplete="off"
            value={draft.openingStock}
            error={errors.openingStock}
            onChange={(event) => set('openingStock', event.target.value)}
          />
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={draft.isQuick}
            onChange={(event) => set('isQuick', event.target.checked)}
            className="size-5 accent-accent"
          />
          Hızlı ürünlere ekle
        </label>
        {errors.form ? (
          <p role="alert" className="font-medium text-danger">
            {errors.form}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          Kaydet
        </Button>
      </form>
      {product && !deleted ? (
        confirmingDelete ? (
          <div className="flex flex-col gap-3 rounded-control border border-line p-3">
            <p className="font-medium">Bu ürün silinsin mi? Satış geçmişi korunur.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await deleteProduct(db, product.id, new Date());
                    return 'Ürün silindi.';
                  }, 'Ürün silinemedi.')
                }
              >
                Sil
              </Button>
              <Button onClick={() => setConfirmingDelete(false)}>Vazgeç</Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Ürünü sil
          </Button>
        )
      ) : null}
    </Dialog>
  );
}
