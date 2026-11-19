import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { formatDay, istanbulToday, isDate } from '@/data/dates';
import { ChoiceGroup, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { buildReceipt } from '@/pos/receipt';
import { loadReceiptSettings, receiptContext } from '@/pos/receiptSettings';
import { ReceiptView } from '@/pos/ReceiptView';
import { periodOf } from '@/reports/period';
import { Chip } from '@/suppliers/ReverseForm';
import { PurchaseLines } from '@/suppliers/SupplierInvoices';
import { listDocuments, type DocumentKind, type DocumentRow } from './documents';

type Filter = DocumentKind | 'all';

const KIND_LABELS: Record<DocumentKind, string> = { sale: 'Satış', purchase: 'Alış' };

/**
 * The sales and the purchases of a range of days, together or one kind at a time, newest first,
 * with what each kind came to at the top. A voided sale or a receipt taken back stays in the
 * list, struck through, and is not counted. Purchases are shown only to a person who may deal
 * with suppliers: they tell what the market pays.
 */
export function DocumentsList(): JSX.Element {
  const { db } = useData();
  const session = useSession();
  const withPurchases = session.can('suppliers');
  const [range, setRange] = useState(() => periodOf('month', istanbulToday()));
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string>();
  const valid = isDate(range.from) && isDate(range.to) && range.from <= range.to;
  const list = useLiveQuery(
    () =>
      valid
        ? listDocuments(db, { ...range, kind: filter, purchases: withPurchases })
        : Promise.resolve(undefined),
    [db, range.from, range.to, filter, withPurchases, valid],
  );

  const filters: { value: Filter; label: string }[] = withPurchases
    ? [
        { value: 'all', label: 'Hepsi' },
        { value: 'sale', label: 'Satış' },
        { value: 'purchase', label: 'Alış' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,12rem))_1fr] sm:items-end">
        <TextField
          label="Başlangıç"
          type="date"
          max={istanbulToday()}
          value={range.from}
          onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
        />
        <TextField
          label="Bitiş"
          type="date"
          max={istanbulToday()}
          value={range.to}
          onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
        />
        {filters.length > 0 ? (
          <ChoiceGroup
            legend="Tür"
            name="documentKind"
            options={filters}
            value={filter}
            onChange={(next) => setFilter(next)}
          />
        ) : null}
      </div>
      {!valid ? (
        <p role="alert" className="font-medium text-danger">
          Geçerli bir tarih aralığı seçin.
        </p>
      ) : null}
      {valid && list ? (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-semibold">
            <p>{`Satış: ${formatTRY(list.totals.sale.total)} · ${list.totals.sale.count} fiş`}</p>
            {withPurchases ? (
              <p>
                {`Alış: ${formatTRY(list.totals.purchase.total)} · ${list.totals.purchase.count} fatura`}
              </p>
            ) : null}
          </div>
          {list.rows.length === 0 ? <p className="text-text-2">Bu aralıkta belge yok.</p> : null}
        </>
      ) : null}
      {/* The table stays while a filter loads, so a person's place is not lost. */}
      {valid && list && list.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-control border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Satışlar ve alışlar</caption>
            <thead>
              <tr className="border-b border-line-strong text-sm text-text-2">
                <th scope="col" className="px-3 py-2 font-medium">
                  Tarih
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Tür
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  No
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Müşteri / tedarikçi
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Ödeme
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Tutar
                </th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => {
                const open = openId === row.id;
                const struck = row.cancelled ? 'line-through' : '';
                return (
                  <Fragment key={row.id}>
                    <tr className="border-b border-line align-middle last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap text-text-2">
                        {formatDay(row.day)}
                      </td>
                      <td className="px-3 py-2">{KIND_LABELS[row.kind]}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? undefined : row.id)}
                          className={`min-h-11 text-left font-mono text-sm font-medium underline-offset-2 hover:underline ${struck}`}
                        >
                          {row.number ?? 'Numarasız'}
                        </button>
                        <span className="block">
                          {row.cancelled ? (
                            <Chip tone="danger">
                              {row.kind === 'sale' ? 'İptal edildi' : 'Geri alındı'}
                            </Chip>
                          ) : null}
                          {row.kind === 'sale' && row.returned ? (
                            <Chip tone="muted">İade var</Chip>
                          ) : null}
                          {row.kind === 'purchase' && row.purchase.correctsId ? (
                            <Chip tone="muted">Düzeltme</Chip>
                          ) : null}
                        </span>
                      </td>
                      <td className={`px-3 py-2 ${struck}`}>{row.counterparty ?? '—'}</td>
                      <td className={`px-3 py-2 ${struck}`}>{row.payment}</td>
                      <td className={`px-3 py-2 text-right font-mono ${struck}`}>
                        {formatTRY(row.total)}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-b border-line">
                        <td colSpan={6} className="px-3 pb-3">
                          <DocumentDetail row={row} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** What a row opens to: a purchase's lines, a sale's receipt as "Son fişler" shows it. */
function DocumentDetail({ row }: { row: DocumentRow }): JSX.Element {
  const { settings: device } = useData();
  if (row.kind === 'purchase') {
    return (
      <div className="overflow-x-auto">
        <PurchaseLines purchase={row.purchase} />
      </div>
    );
  }
  const settings = loadReceiptSettings();
  const model = buildReceipt(row.sale, {
    ...receiptContext(device, settings),
    customerName: row.counterparty,
    status: { voided: row.cancelled, returnedAny: row.returned },
  });
  return (
    <section
      aria-label={`Fiş ${row.sale.receiptNo}`}
      className="max-h-[60dvh] max-w-md overflow-y-auto rounded-control border border-line bg-white"
    >
      <ReceiptView model={model} paperWidth={settings.paperWidth} />
    </section>
  );
}
