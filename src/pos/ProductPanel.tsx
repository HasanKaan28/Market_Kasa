import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
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
import { CameraButton } from './CameraButton';
import { formatQty } from './format';
import { looksLikeBarcode } from './keyboard';
import { readMultiplier } from './multiplier';

/** The group of the quick products, which comes before the categories. */
const QUICK = 'quick';
// Search results keep showing while the next query runs: the heading stays the same.
const SEARCH = 'search';

export type ProductPanelProps = {
  /** `qtyMilli` when a count was typed before a star ("10*"); otherwise one. */
  onAdd(product: ProductRecord, qtyMilli?: number): void;
  onNewProduct(barcode?: string): void;
  /** A code read by the camera, handled as the register handles a scanner's. */
  onScan?(code: string): void;
  searchRef?: Ref<HTMLInputElement>;
  /**
   * Filled with a function the register calls on a scan: it hands over the count typed before a
   * star, if any, and clears the search. A scanner's keys never reach the search's own handlers.
   */
  takeCountRef?: RefObject<(() => number | undefined) | null>;
};

/** Search by name or barcode, the quick-product grid, and the way to add a missing product. */
export function ProductPanel({
  onAdd,
  onNewProduct,
  onScan,
  searchRef,
  takeCountRef,
}: ProductPanelProps): JSX.Element {
  const { db } = useData();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(QUICK);
  const multiplier = readMultiplier(query);
  const term = multiplier ? multiplier.rest : query.trim();
  // Read by the register on a scan, which comes after this render has been committed.
  const latestQuery = useRef(query);
  useLayoutEffect(() => {
    latestQuery.current = query;
  });

  useEffect(() => {
    if (!takeCountRef) {
      return;
    }
    takeCountRef.current = () => {
      const counted = readMultiplier(latestQuery.current);
      if (!counted) {
        return undefined;
      }
      setQuery('');
      return counted.qtyMilli;
    };
    return () => {
      takeCountRef.current = null;
    };
  }, [takeCountRef]);
  const categories = useLiveQuery(() => listCategories(db), [db]);
  // A category deleted here or on another register falls back to the quick products.
  const category = categories?.find((item) => item.id === group);
  const groupId = category?.id ?? QUICK;
  // The answer carries the list it was asked for: until the new group's products arrive, the old
  // group's tiles must not sit under the new heading, where a quick tap would sell the wrong one.
  const listKey = term === '' ? groupId : SEARCH;
  const answer = useLiveQuery(async () => {
    if (term !== '') {
      return { key: SEARCH, products: await searchProducts(db, term) };
    }
    const products =
      groupId === QUICK ? await listQuickProducts(db) : await listProductsInCategory(db, groupId);
    return { key: groupId, products };
  }, [db, term, groupId]);
  const products = answer?.key === listKey ? answer.products : undefined;

  function choose(product: ProductRecord) {
    if (multiplier) {
      onAdd(product, multiplier.qtyMilli);
    } else {
      onAdd(product);
    }
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
        hint={
          multiplier
            ? `Sıradaki ürün ${formatQty(multiplier.qtyMilli)} ${multiplier.qtyMilli % 1000 === 0 ? 'adet' : 'kg'} eklenir.`
            : 'Okuyucu ile okutun ya da yazmaya başlayın. Önce “10*” yazarsanız 10 adet eklenir.'
        }
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
        <div className="flex flex-wrap gap-2">
          {onScan ? <CameraButton onScan={onScan} /> : null}
          <Button icon={<Plus aria-hidden="true" size={18} />} onClick={() => onNewProduct()}>
            Yeni ürün
          </Button>
        </div>
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
