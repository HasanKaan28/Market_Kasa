import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { listCategories } from '@/data/categories';
import { findProductByBarcode } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, SelectField, TextField, ToastRegion, useToast } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { formatTRY } from '@/domain/money';
import { formatStock } from '@/pos/format';
import { useBarcodeScanner } from '@/pos/keyboard';
import { CategoriesDialog } from './CategoriesDialog';
import { downloadText, productsToCsv } from './exportCsv';
import { ImportDialog } from './ImportDialog';
import { ProductFormDialog } from './ProductFormDialog';
import {
  buildProductRows,
  criticalCount,
  indexProducts,
  type CategoryChoice,
  type ProductFilter,
  type ProductRow,
} from './productList';

const PAGE_SIZE = 100;

type OpenDialog =
  | { kind: 'product'; product?: ProductRecord; barcode?: string }
  | { kind: 'categories' }
  | { kind: 'import' }
  | null;

/** The catalogue: every product with its stock and category, and the way to add or change one. */
export function ProductsScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const toast = useToast();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [category, setCategory] = useState<CategoryChoice>('any');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const catalogue = useLiveQuery(async () => {
    const [products, levels, categories] = await Promise.all([
      db.products.toArray(),
      db.stockLevels.toArray(),
      listCategories(db),
    ]);
    const stock = new Map(levels.map((level) => [level.productId, level.qtyMilli]));
    return {
      products,
      stock,
      categories,
      // Worked out once per change to the catalogue, so typing (or a scan) stays quick.
      index: indexProducts(products),
      liveCount: products.filter((product) => !product.deletedAt).length,
      critical: criticalCount(products, stock),
    };
  }, [db]);

  // A category deleted here or on another register no longer narrows the list.
  const categoryChoice =
    category === 'any' ||
    category === 'none' ||
    !catalogue ||
    catalogue.categories.some((item) => item.id === category)
      ? category
      : 'any';

  const rows = useMemo(
    () =>
      catalogue
        ? buildProductRows(catalogue.index, catalogue.stock, catalogue.categories, {
            text,
            filter,
            category: categoryChoice,
          })
        : [],
    [catalogue, text, filter, categoryChoice],
  );

  async function openByBarcode(code: string) {
    const product = await findProductByBarcode(db, code, { includeDeleted: true });
    setDialog(product ? { kind: 'product', product } : { kind: 'product', barcode: code });
  }

  // A scan opens the product it belongs to, deleted or not, or a new one; an open form takes
  // scans for its own barcode box instead.
  useBarcodeScanner((code) => {
    if (dialog === null) {
      void openByBarcode(code);
    }
  });

  function search(next: () => void) {
    next();
    setLimit(PAGE_SIZE);
  }

  function saved(message: string) {
    setDialog(null);
    toast.show(message);
    void runner.run();
  }

  const close = () => setDialog(null);
  const liveCount = catalogue?.liveCount ?? 0;
  const critical = catalogue?.critical ?? 0;
  const categoryOptions = [
    { value: 'any', label: 'Tüm kategoriler' },
    { value: 'none', label: 'Kategorisiz' },
    ...(catalogue?.categories ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  const filterOptions: { value: ProductFilter; label: string }[] = [
    { value: 'all', label: 'Tümü' },
    { value: 'critical', label: `Kritik stok (${critical})` },
    { value: 'quick', label: 'Hızlı ürünler' },
    { value: 'deleted', label: 'Silinenler' },
  ];

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        activeNav="products"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">Ürünler</h1>
            <p className="text-sm text-text-2">{`${liveCount} ürün`}</p>
          </div>
          <Button onClick={() => setDialog({ kind: 'import' })}>İçe aktar</Button>
          <Button
            disabled={rows.length === 0}
            onClick={() =>
              downloadText(`urunler-${businessDate(new Date())}.csv`, productsToCsv(rows))
            }
          >
            Dışa aktar
          </Button>
          <Button onClick={() => setDialog({ kind: 'categories' })}>Kategoriler</Button>
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" size={18} />}
            onClick={() => setDialog({ kind: 'product' })}
          >
            Yeni ürün
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-[2_1_260px]">
            <TextField
              label="Ürün ara"
              type="search"
              placeholder="Ad ya da barkod"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(event) => search(() => setText(event.target.value))}
            />
          </div>
          <div className="min-w-0 flex-[1_1_200px]">
            <SelectField
              label="Kategori"
              value={categoryChoice}
              options={categoryOptions}
              onChange={(event) => search(() => setCategory(event.target.value))}
            />
          </div>
        </div>
        <ChoiceGroup
          legend="Göster"
          name="filter"
          options={filterOptions}
          value={filter}
          onChange={(next) => search(() => setFilter(next))}
        />

        {catalogue ? (
          <ProductTable
            rows={rows}
            limit={limit}
            empty={catalogue.products.length === 0}
            onOpen={(product) => setDialog({ kind: 'product', product })}
            onMore={() => setLimit((current) => current + PAGE_SIZE)}
          />
        ) : null}
      </AppShell>

      {dialog?.kind === 'product' ? (
        <ProductFormDialog
          open
          product={dialog.product}
          barcode={dialog.barcode}
          onClose={close}
          onSaved={saved}
        />
      ) : null}
      {dialog?.kind === 'categories' ? <CategoriesDialog open onClose={close} /> : null}
      {dialog?.kind === 'import' ? <ImportDialog open onClose={close} onDone={saved} /> : null}
      <ToastRegion message={toast.message} />
    </>
  );
}

function ProductTable({
  rows,
  limit,
  empty,
  onOpen,
  onMore,
}: {
  rows: readonly ProductRow[];
  limit: number;
  /** No product at all yet, as opposed to none matching the search. */
  empty: boolean;
  onOpen(product: ProductRecord): void;
  onMore(): void;
}): JSX.Element {
  if (rows.length === 0) {
    return empty ? (
      <div className="flex flex-col gap-1 py-8 text-center text-text-2">
        <p className="font-semibold text-text">Henüz ürün yok.</p>
        <p>“Yeni ürün” ile başlayın ya da bir barkod okutun.</p>
      </div>
    ) : (
      <p className="py-8 text-center text-text-2">Aramaya uyan ürün yok.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Ürün listesi</caption>
        <thead className="border-b border-line-strong text-sm text-text-2">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Ürün
            </th>
            <th scope="col" className="hidden py-2 pr-3 font-medium md:table-cell">
              Kategori
            </th>
            <th scope="col" className="w-24 py-2 pr-3 text-right font-medium md:w-32">
              Satış fiyatı
            </th>
            <th scope="col" className="w-24 py-2 text-right font-medium md:w-32">
              Stok
            </th>
            <th scope="col" className="hidden w-16 py-2 pl-3 text-right font-medium lg:table-cell">
              KDV
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row) => (
            <ProductTableRow key={row.product.id} row={row} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
      {rows.length > limit ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-2">{`${limit} / ${rows.length} ürün`}</p>
          <Button onClick={onMore}>Daha fazla göster</Button>
        </div>
      ) : null}
    </div>
  );
}

function ProductTableRow({
  row,
  onOpen,
}: {
  row: ProductRow;
  onOpen(product: ProductRecord): void;
}): JSX.Element {
  const { product, stockMilli, categoryName, critical } = row;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="py-1.5 pr-3">
        <button
          type="button"
          onClick={() => onOpen(product)}
          className="min-h-11 w-full rounded-control text-left font-medium break-words hover:text-accent"
        >
          {product.name}
        </button>
        {product.barcode ? (
          <span className="block font-mono text-sm break-all text-text-2">{product.barcode}</span>
        ) : null}
      </td>
      <td className="hidden py-3 pr-3 text-text-2 md:table-cell">{categoryName ?? '—'}</td>
      <td className="py-3 pr-3 text-right">{formatTRY(product.sellPrice)}</td>
      <td className={`py-3 text-right ${stockMilli < 0 ? 'text-danger' : ''}`}>
        {formatStock(stockMilli, product.unit)}
        {critical ? (
          <span className="mt-1 block">
            <span className="rounded-full bg-warning-bg px-2 py-0.5 text-sm font-medium text-warning">
              Kritik
            </span>
          </span>
        ) : null}
      </td>
      <td className="hidden py-3 pl-3 text-right text-text-2 lg:table-cell">{`%${product.vatRate}`}</td>
    </tr>
  );
}
