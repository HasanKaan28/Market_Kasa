import { useId, useState, type ChangeEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { listCategories } from '@/data/categories';
import { DuplicateBarcodeError } from '@/data/errors';
import { Button, Dialog, SelectField } from '@/design';
import { decodeText, parseCsv } from './importFile';
import {
  applyImport,
  planImport,
  type ImportAction,
  type ImportPlan,
  type PlannedRow,
} from './importPlan';
import {
  guessMapping,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  readImportRows,
  type ColumnMapping,
  type ImportRow,
} from './importRows';
import { readXlsx } from './xlsx';

export type ImportDialogProps = {
  open: boolean;
  onClose(): void;
  /** Called with the message to show once the products are written. */
  onDone(message: string): void;
};

const PREVIEW_ROWS = 50;
const LISTED_ERROR_ROWS = 20;
const SAMPLE_LENGTH = 24;
const UNREADABLE = 'Dosya okunamadı. CSV ya da XLSX seçin.';

const ACTION_LABELS: Record<ImportAction, string> = {
  create: 'Yeni',
  update: 'Güncellenecek',
  unchanged: 'Aynı',
  error: 'Hatalı',
};

type Loaded = { fileName: string; table: string[][] };
type Preview = { rows: ImportRow[]; plan: ImportPlan };

/** Reads a CSV or Excel file, lets the user match its columns, previews the result, imports it. */
export function ImportDialog({ open, onClose, onDone }: ImportDialogProps): JSX.Element {
  const { db } = useData();
  const inputId = useId();
  const [loaded, setLoaded] = useState<Loaded>();
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared at once: choosing the same file again, corrected in Excel, must be read again.
    event.target.value = '';
    if (!file) {
      return;
    }
    setPreview(undefined);
    const table = await readTable(file);
    if (!table || table.length === 0) {
      setLoaded(undefined);
      setError(UNREADABLE);
      return;
    }
    const guessed = guessMapping(table[0] ?? []);
    setError(undefined);
    setLoaded({ fileName: file.name, table });
    setMapping(guessed);
    // A first row that names a known column is a header; otherwise every row is data.
    setHasHeader(Object.keys(guessed).length > 0);
  }

  async function showPreview() {
    if (!loaded) {
      return;
    }
    const rows = readImportRows(loaded.table, mapping, hasHeader);
    const [products, categories, levels] = await Promise.all([
      db.products.toArray(),
      listCategories(db),
      db.stockLevels.toArray(),
    ]);
    const stock = new Map(levels.map((level) => [level.productId, level.qtyMilli]));
    setPreview({ rows, plan: planImport(rows, products, categories, stock) });
  }

  async function apply() {
    if (!preview) {
      return;
    }
    setBusy(true);
    try {
      const { created, updated } = await applyImport(db, preview.plan, preview.rows, new Date());
      onDone(`${created} ürün eklendi, ${updated} ürün güncellendi.`);
    } catch (failure) {
      setError(
        failure instanceof DuplicateBarcodeError
          ? `İçe aktarılamadı: ${failure.barcode} barkodu bu arada “${failure.holderName}” ürününe verildi. Hiçbir ürün değişmedi; önizlemeye yeniden bakın.`
          : 'İçe aktarılamadı. Hiçbir ürün değişmedi.',
      );
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Ürünleri içe aktar"
      size="lg"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-text">
          Dosya seç
        </label>
        <input
          id={inputId}
          type="file"
          accept=".csv,.txt,.xlsx,text/csv"
          aria-describedby={`${inputId}-hint`}
          onChange={(event) => void chooseFile(event)}
          className="min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-base file:mr-3 file:rounded-chip file:border-0 file:bg-bg file:px-3 file:py-1.5 file:font-medium"
        />
        <p id={`${inputId}-hint`} className="text-sm text-muted">
          Excel'den kaydedilen CSV ya da XLSX. v1'in ürün listesi de okunur.
        </p>
      </div>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {loaded && !preview ? (
        <ColumnsStep
          loaded={loaded}
          mapping={mapping}
          hasHeader={hasHeader}
          onMapping={setMapping}
          onHasHeader={setHasHeader}
          onContinue={() => void showPreview()}
        />
      ) : null}
      {preview ? (
        <PreviewStep
          plan={preview.plan}
          busy={busy}
          onBack={() => setPreview(undefined)}
          onApply={() => void apply()}
        />
      ) : null}
    </Dialog>
  );
}

function ColumnsStep({
  loaded,
  mapping,
  hasHeader,
  onMapping,
  onHasHeader,
  onContinue,
}: {
  loaded: Loaded;
  mapping: ColumnMapping;
  hasHeader: boolean;
  onMapping(next: ColumnMapping): void;
  onHasHeader(next: boolean): void;
  onContinue(): void;
}): JSX.Element {
  const { table } = loaded;
  const width = Math.max(...table.map((row) => row.length));
  const dataRows = hasHeader ? table.slice(1) : table;
  const columns = Array.from({ length: width }, (_, index) => ({
    value: String(index),
    label: columnLabel(index, hasHeader ? table[0]?.[index] : undefined, dataRows),
  }));
  const options = [{ value: '', label: 'Kullanma' }, ...columns];
  const canContinue = mapping.name !== undefined || mapping.sellPrice !== undefined;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-2">{`${loaded.fileName} · ${dataRows.length} satır`}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={hasHeader}
          onChange={(event) => onHasHeader(event.target.checked)}
          className="size-5 accent-accent"
        />
        İlk satır başlık
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {IMPORT_FIELDS.map((field) => (
          <SelectField
            key={field}
            label={IMPORT_FIELD_LABELS[field]}
            value={mapping[field] === undefined ? '' : String(mapping[field])}
            options={options}
            onChange={(event) =>
              onMapping({
                ...mapping,
                [field]: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          />
        ))}
      </div>
      {mapping.vatRate === undefined ? (
        <p className="text-sm text-text-2">
          KDV sütunu seçilmedi: yeni ürünler %1 KDV ile eklenir.
        </p>
      ) : null}
      {mapping.stock !== undefined ? (
        <p className="text-sm text-text-2">
          Stok yalnız yeni ürünlerin başlangıç stoğu olur; var olan ürünlerin stoğu değişmez.
        </p>
      ) : null}
      <div>
        <Button variant="primary" disabled={!canContinue} onClick={onContinue}>
          Devam
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  plan,
  busy,
  onBack,
  onApply,
}: {
  plan: ImportPlan;
  busy: boolean;
  onBack(): void;
  onApply(): void;
}): JSX.Element {
  const { counts } = plan;
  const toWrite = counts.create + counts.update;
  const errorRows = plan.rows.filter((row) => row.action === 'error').map((row) => row.rowNumber);
  const listedErrors =
    errorRows.length > LISTED_ERROR_ROWS
      ? `${errorRows.slice(0, LISTED_ERROR_ROWS).join(', ')} …`
      : errorRows.join(', ');

  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium">
        {`${counts.create} yeni, ${counts.update} güncellenecek, ${counts.unchanged} aynı, ${counts.error} hatalı`}
      </p>
      {plan.newCategories.length > 0 ? (
        <p>{`Yeni kategoriler: ${plan.newCategories.join(', ')}`}</p>
      ) : null}
      {errorRows.length > 0 ? (
        <p className="text-danger">{`Hatalı satırlar: ${listedErrors}`}</p>
      ) : null}
      <p className="text-sm text-text-2">İçe aktarmayı tek kasadan yapın.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <caption className="sr-only">Önizleme</caption>
          <thead className="border-b border-line-strong text-sm text-text-2">
            <tr>
              <th scope="col" className="w-16 py-2 pr-3 font-medium">
                Satır
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Ürün
              </th>
              <th scope="col" className="w-36 py-2 pr-3 font-medium">
                Durum
              </th>
              <th scope="col" className="py-2 font-medium">
                Ayrıntı
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.slice(0, PREVIEW_ROWS).map((row) => (
              <tr key={row.rowNumber} className="border-b border-line align-top last:border-0">
                <td className="py-2 pr-3">{row.rowNumber}</td>
                <td className="py-2 pr-3 break-words">{row.name || '—'}</td>
                <td className={`py-2 pr-3 ${row.action === 'error' ? 'text-danger' : ''}`}>
                  {ACTION_LABELS[row.action]}
                </td>
                <td className="py-2 text-text-2">{details(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.rows.length > PREVIEW_ROWS ? (
        <p className="text-sm text-text-2">{`İlk ${PREVIEW_ROWS} satır gösteriliyor.`}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onBack}>Geri</Button>
        <Button variant="primary" disabled={busy || toWrite === 0} onClick={onApply}>
          {`${toWrite} ürünü içe aktar`}
        </Button>
      </div>
    </div>
  );
}

/** What a preview row says beside its status: errors, or what changes, and any warnings. */
function details(row: PlannedRow): string {
  if (row.errors.length > 0) {
    return row.errors.join(' ');
  }
  const parts = [
    ...(row.restore ? ['Geri getirilecek.'] : []),
    ...(row.changes.length > 0 ? [row.changes.join(', ')] : []),
    ...row.warnings,
  ];
  return parts.join(' ');
}

/** "B · Ürün Adı (Süt 1 L, Ekmek)": the column letter, its header and its first two values. */
function columnLabel(index: number, header: string | undefined, rows: readonly string[][]): string {
  const samples = rows
    .map((row) => row[index]?.trim() ?? '')
    .filter((value) => value !== '')
    .slice(0, 2)
    .map((value) => shorten(value));
  const named = header?.trim() ? ` · ${header.trim()}` : '';
  const shown = samples.length > 0 ? ` (${samples.join(', ')})` : '';
  return `${columnLetter(index)}${named}${shown}`;
}

function columnLetter(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function shorten(text: string): string {
  const characters = Array.from(text);
  return characters.length > SAMPLE_LENGTH
    ? `${characters.slice(0, SAMPLE_LENGTH - 1).join('')}…`
    : text;
}

/** The table in a file: an Excel workbook (a zip) or CSV text; nothing when it cannot be read. */
async function readTable(file: File): Promise<string[][] | undefined> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isZip || file.name.toLowerCase().endsWith('.xlsx')) {
      return readXlsx(bytes);
    }
    return parseCsv(decodeText(bytes));
  } catch {
    return undefined;
  }
}
