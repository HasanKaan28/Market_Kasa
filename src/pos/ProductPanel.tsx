import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState, type JSX, type KeyboardEvent, type Ref } from 'react';
import { useData } from '@/app/appData';
import { findProductByBarcode, listQuickProducts, searchProducts } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { Button, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { looksLikeBarcode } from './keyboard';

export type ProductPanelProps = {
  onAdd(product: ProductRecord): void;
  onNewProduct(barcode?: string): void;
  searchRef?: Ref<HTMLInputElement>;
};

/** Search by name or barcode, the quick-product grid, and the way to add a missing product. */
export function ProductPanel({ onAdd, onNewProduct, searchRef }: ProductPanelProps): JSX.Element {
  const { db } = useData();
  const [query, setQuery] = useState('');
  const term = query.trim();
  const products = useLiveQuery(
    () => (term === '' ? listQuickProducts(db) : searchProducts(db, term)),
    [db, term],
  );

  function choose(product: ProductRecord) {
    onAdd(product);
    setQuery('');
  }

  // Only typed input reaches here: a scanner's Enter is taken by useBarcodeScanner first.
  async function submit(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || term === '') {
      return;
    }
    event.preventDefault();
    const product = await findProductByBarcode(db, term);
    if (product) {
      choose(product);
    } else if (looksLikeBarcode(term)) {
      onNewProduct(term);
      setQuery('');
    }
  }

  return (
    <section aria-label="Ürünler" className="flex flex-col gap-4">
      <TextField
        ref={searchRef}
        label="Barkod veya ürün adı"
        hint="Okuyucu ile okutun ya da yazmaya başlayın."
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => void submit(event)}
      />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">
          {term === '' ? 'Hızlı ürünler' : 'Arama sonuçları'}
        </h2>
        <Button icon={<Plus aria-hidden="true" size={18} />} onClick={() => onNewProduct()}>
          Yeni ürün
        </Button>
      </div>
      {term !== '' && products?.length === 0 ? <p className="text-text-2">Sonuç yok</p> : null}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {products?.map((product) => (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => choose(product)}
              className="flex min-h-16 w-full flex-col items-start justify-center gap-0.5 rounded-control border border-line bg-surface px-3 py-2 text-left hover:border-line-strong"
            >
              <span className="leading-snug font-medium">{product.name}</span>{' '}
              <span className="font-mono text-sm text-text-2">{formatTRY(product.sellPrice)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
