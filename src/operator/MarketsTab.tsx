import { ChevronRight, Search } from 'lucide-react';
import { useState, type JSX } from 'react';
import { ChoiceGroup, SelectField, TextField } from '@/design';
import type { OperatorApi, OperatorMarket } from './api';
import { agoText, countText, dayText, moneyText, planDateText } from './model';
import { TONES, useLoad } from './load';
import { Alert, Loading, TabHeading } from './ui';

type StatusFilter = 'all' | 'active' | 'suspended' | 'quiet';
type Sort = 'newest' | 'name' | 'sync' | 'sales';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Yeni açılan önce' },
  { value: 'name', label: 'Ada göre' },
  { value: 'sync', label: 'Son eşitlenen önce' },
  { value: 'sales', label: '30 gün satışı en çok' },
];

const WEEK_MS = 7 * 86_400_000;

/** Whether a market with registers has not reached the server for a week. */
function isQuiet(market: OperatorMarket, now: Date): boolean {
  return (
    market.status === 'active' &&
    market.devices > 0 &&
    (market.lastSyncAt === null || now.getTime() - Date.parse(market.lastSyncAt) > WEEK_MS)
  );
}

const time = (at: string | null | undefined) => (at ? Date.parse(at) : 0);

function sortMarkets(markets: OperatorMarket[], sort: Sort): OperatorMarket[] {
  const sorted = [...markets];
  switch (sort) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    case 'sync':
      return sorted.sort((a, b) => time(b.lastSyncAt) - time(a.lastSyncAt));
    case 'sales':
      return sorted.sort((a, b) => (b.sales30?.total ?? 0) - (a.sales30?.total ?? 0));
    default:
      return sorted.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  }
}

/** Every market with its registers, staff, last sync and sales; searched, filtered and sorted. */
export function MarketsTab({
  api,
  onOpen,
  now = () => new Date(),
}: {
  api: OperatorApi;
  onOpen(marketId: string): void;
  now?: () => Date;
}): JSX.Element {
  const { data, error, reload } = useLoad(() => api.listMarkets(), 'markets');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const at = now();
  const needle = query.trim().toLocaleLowerCase('tr');
  const shown = data
    ? sortMarkets(
        data.filter(
          (market) =>
            (status === 'all' ||
              (status === 'quiet' ? isQuiet(market, at) : market.status === status)) &&
            (needle === '' ||
              [market.name, market.id, market.ownerEmail ?? '', market.plan ?? '']
                .join(' ')
                .toLocaleLowerCase('tr')
                .includes(needle)),
        ),
        sort,
      )
    : undefined;

  return (
    <section aria-labelledby="markets" className="flex flex-col gap-3">
      <TabHeading id="markets" title="Marketler" onReload={reload} />
      {error ? <Alert>{error}</Alert> : null}
      {data === undefined && !error ? <Loading /> : null}
      {data?.length === 0 ? <p className="text-text-2">Henüz market yok.</p> : null}
      {data && data.length > 0 ? (
        <>
          <div className="relative">
            <TextField
              label="Market ara"
              type="search"
              placeholder="Ad, e-posta ya da paket"
              className="w-full pl-10"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Search
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute bottom-[15px] left-3.5 text-muted"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-end">
            <ChoiceGroup<StatusFilter>
              legend="Durum"
              name="market-status"
              wrap
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'Tümü' },
                { value: 'active', label: 'Etkin' },
                { value: 'suspended', label: 'Askıda' },
                { value: 'quiet', label: 'Sessiz' },
              ]}
            />
            <SelectField
              label="Sırala"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              options={SORTS}
            />
          </div>
          <p className="text-sm text-text-2">{`${countText(shown?.length ?? 0)} / ${countText(data.length)} market`}</p>
          {shown?.length === 0 ? <p className="text-text-2">Bu aramaya uyan market yok.</p> : null}
          <ul className="flex flex-col gap-3">
            {shown?.map((market) => (
              <MarketRow
                key={market.id}
                market={market}
                now={at}
                quiet={isQuiet(market, at)}
                onOpen={() => onOpen(market.id)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function MarketRow({
  market,
  now,
  quiet,
  onOpen,
}: {
  market: OperatorMarket;
  now: Date;
  quiet: boolean;
  onOpen(): void;
}): JSX.Element {
  const suspended = market.status === 'suspended';
  const plan = market.planUntil ? planDateText(market.planUntil, now) : null;
  const edge = suspended
    ? '[--slip-edge:var(--color-warning)]'
    : quiet
      ? '[--slip-edge:var(--color-line-strong)]'
      : 'edge-accent';
  return (
    <li className={`slip ${edge} flex min-w-0 flex-col gap-2 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="-ml-1 max-w-full min-w-0 font-display text-label font-semibold">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-control px-1 text-left hover:bg-bg"
          >
            <span className="min-w-0 break-words">{market.name}</span>
            <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />
          </button>
        </h3>
        {suspended ? (
          <span className="rounded-chip bg-warning-bg px-2.5 py-0.5 text-meta font-semibold text-warning">
            Askıda
          </span>
        ) : null}
        {quiet ? (
          <span className="rounded-chip bg-bg px-2.5 py-0.5 text-meta font-semibold text-text-2">
            Sessiz
          </span>
        ) : null}
        {market.plan ? (
          <span className="rounded-chip bg-bg px-2.5 py-0.5 text-meta font-semibold text-text-2">
            {market.plan}
          </span>
        ) : null}
      </div>
      <p className="truncate text-sm text-text-2">{market.ownerEmail ?? 'Sahip hesabı yok'}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-sm">
        <dt className="text-muted">Cihaz</dt>
        <dd>
          {`${countText(market.devices)} cihaz`}
          {market.staff !== undefined ? ` · ${countText(market.staff)} personel` : ''}
        </dd>
        <dt className="text-muted">Son eşitleme</dt>
        <dd>{agoText(market.lastSyncAt, now)}</dd>
        {market.sales30 ? (
          <>
            <dt className="text-muted">30 gün</dt>
            <dd className="tabular-nums">
              {`${countText(market.sales30.count)} satış · ${moneyText(market.sales30.total)}`}
            </dd>
          </>
        ) : null}
        {market.lastSaleAt !== undefined ? (
          <>
            <dt className="text-muted">Son satış</dt>
            <dd>{agoText(market.lastSaleAt, now)}</dd>
          </>
        ) : null}
        {plan && market.planUntil ? (
          <>
            <dt className="text-muted">Paket tarihi</dt>
            <dd>
              <span className={`font-medium ${TONES[plan.tone]}`}>{plan.text}</span>
              <span className="text-text-2">{` · ${dayText(market.planUntil)}`}</span>
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Açılış</dt>
        <dd>
          {dayText(market.createdAt)}
          {market.activationCode ? (
            <span className="font-mono text-meta text-text-2">{` · ${market.activationCode}`}</span>
          ) : null}
        </dd>
      </dl>
    </li>
  );
}
