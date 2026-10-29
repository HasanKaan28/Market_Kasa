import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState, type JSX, type KeyboardEvent, type Ref } from 'react';
import { useData } from '@/app/appData';
import { listCategories } from '@/data/categories';
import {
  findProductByBarcode,
  listProductsInCategory,
  listQuickProducts,
  searchProducts,
} from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { looksLikeBarcode } from './keyboard';

/** The group of the quick products, which comes before the categories. */
const QUICK = 'quick';

export type ProductPanelProps = {
  onAdd(product: ProductRecord): void;
  onNewProduct(barcode?: string): void;
  searchRef?: Ref<HTMLInputElement>;
};

/** Search by name or barcode, the quick-product grid, and the way to add a missing product. */
export function ProductPanel({ onAdd, onNewProduct, searchRef }: ProductPanelProps): JSX.Element {
  const { db } = useData();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(QUICK);
  const term = query.trim();
  const categories = useLiveQuery(() => listCategories(db), [db]);
  // A category deleted here or on another register falls back to the quick products.
  const category = categories?.find((item) => item.id === group);
  const groupId = category?.id ?? QUICK;
  const products = useLiveQuery(() => {
    if (term !== '') {
      return searchProducts(db, term);
    }
    return groupId === QUICK ? listQuickProducts(db) : listProductsInCategory(db, groupId);
  }, [db, term, groupId]);

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
      {term === '' && categories && categories.length > 0 ? (
        <ChoiceGroup
          legend="Ürün grubu"
          name="productGroup"
          wrap
          options={[
            { value: QUICK, label: 'Hızlı' },
            ...categories.map((item) => ({ value: item.id, label: item.name })),
          ]}
          value={groupId}
          onChange={(next) => setGroup(next)}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">
          {term !== '' ? 'Arama sonuçları' : (category?.name ?? 'Hızlı ürünler')}
        </h2>
        <Button icon={<Plus aria-hidden="true" size={18} />} onClick={() => onNewProduct()}>
          Yeni ürün
        </Button>
      </div>
      {term !== '' && products?.length === 0 ? <p className="text-text-2">Sonuç yok</p> : null}
      {term === '' && category && products?.length === 0 ? (
        <p className="text-text-2">Bu grupta ürün yok.</p>
      ) : null}
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
