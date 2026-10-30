import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { DuplicateBarcodeError } from '@/data/errors';
import { createProduct } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY, type Kurus } from '@/domain/money';
import { MAX_UNIT_PRICE, type VatRate } from '@/domain/pricing';
import { VAT_OPTIONS } from './format';

export type NewProductDialogProps = {
  open: boolean;
  barcode?: string;
  onClose(): void;
  onCreated(product: ProductRecord): void;
};

type Errors = { name?: string; price?: string; form?: string };

/** Adds a product at the register: from an unknown barcode, or without one (bread, simit). */
export function NewProductDialog({
  open,
  barcode,
  onClose,
  onCreated,
}: NewProductDialogProps): JSX.Element {
  const { db } = useData();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [vatRate, setVatRate] = useState<VatRate>(1);
  const [isQuick, setIsQuick] = useState(barcode === undefined);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Errors = {};
    if (name.trim() === '') {
      found.name = 'Ürün adı gerekli.';
    }
    let sellPrice: Kurus | undefined;
    try {
      sellPrice = parseTRY(price);
    } catch {
      found.price = 'Geçerli bir tutar girin.';
    }
    if (sellPrice !== undefined && sellPrice > MAX_UNIT_PRICE) {
      found.price = `Fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.`;
      sellPrice = undefined;
    }
    setErrors(found);
    if (found.name !== undefined || sellPrice === undefined) {
      return;
    }
    setSaving(true);
    try {
      const product = await createProduct(
        db,
        { barcode, name, sellPrice, vatRate, isQuick },
        new Date(),
      );
      onCreated(product);
    } catch (error) {
      setErrors({
        form:
          error instanceof DuplicateBarcodeError
            ? 'Bu barkod başka bir üründe kayıtlı.'
            : 'Ürün kaydedilemedi.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Yeni ürün">
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        {barcode ? (
          <p className="text-text-2">
            Barkod: <span className="font-mono text-text">{barcode}</span>
          </p>
        ) : null}
        <TextField
          label="Ürün adı"
          autoFocus
          autoComplete="off"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Satış fiyatı"
          hint="Örnek: 12,50"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          error={errors.price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <ChoiceGroup
          legend="KDV oranı"
          name="vatRate"
          options={VAT_OPTIONS}
          value={vatRate}
          onChange={(rate) => setVatRate(rate)}
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={isQuick}
            onChange={(event) => setIsQuick(event.target.checked)}
            className="size-5 accent-accent"
          />
          Hızlı ürünlere ekle
        </label>
        {errors.form ? (
          <p role="alert" className="font-medium text-danger">
            {errors.form}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={saving}>
          Kaydet ve sepete ekle
        </Button>
      </form>
    </Dialog>
  );
}
