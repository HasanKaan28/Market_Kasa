import { ChevronRight } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Button } from '@/design';
import { messageOf, type OperatorApi, type Overview } from './api';
import {
  addDays,
  agoText,
  countText,
  dateTimeText,
  dayInTurkey,
  dayText,
  moneyText,
  planDateText,
} from './model';
import { TONES, useLoad } from './load';
import { Alert, Figures, Loading, TabHeading } from './ui';

/**
 * The first look: markets, codes, registers and sales across every market, the unused codes
 * ending this week, plan dates near or just past (a reminder only), and quiet markets.
 */
export function OverviewTab({
  api,
  onOpen,
  notify,
  now = () => new Date(),
}: {
  api: OperatorApi;
  onOpen(marketId: string): void;
  notify(message: string): void;
  now?: () => Date;
}): JSX.Element {
  const { data, error, reload } = useLoad(() => api.overview(), 'overview');

  return (
    <section aria-labelledby="overview" className="flex flex-col gap-5">
      <TabHeading id="overview" title="Özet" onReload={reload} />
      {error ? <Alert>{error}</Alert> : null}
      {data === undefined && !error ? <Loading /> : null}
      {data ? (
        <>
          <Numbers overview={data} />
          <ExpiringCodes overview={data} api={api} notify={notify} onChanged={reload} />
          <PlanDue
            overview={data}
            api={api}
            now={now()}
            notify={notify}
            onOpen={onOpen}
            onChanged={reload}
          />
          <Quiet overview={data} now={now()} onOpen={onOpen} />
        </>
      ) : null}
    </section>
  );
}

function Group({ title, children }: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-meta font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Numbers({ overview }: { overview: Overview }): JSX.Element {
  const { markets, codes, devices, sales } = overview;
  return (
    <div className="flex flex-col gap-4">
      <Group title="Satış · tüm marketler">
        <Figures
          label="Satış"
          items={[
            {
              label: `Bugün · ${countText(sales.today.count)} satış`,
              value: moneyText(sales.today.total),
            },
            {
              label: `Son 30 gün · ${countText(sales.last30.count)} satış`,
              value: moneyText(sales.last30.total),
            },
          ]}
          columns="max-sm:grid-cols-1 sm:grid-cols-2"
        />
      </Group>
      <Group title="Marketler">
        <Figures
          label="Marketler"
          items={[
            { label: 'Toplam', value: countText(markets.total) },
            { label: 'Etkin', value: countText(markets.active) },
            {
              label: 'Askıda',
              value: countText(markets.suspended),
              ...(markets.suspended > 0 ? { tone: 'text-warning' } : {}),
            },
            { label: 'Son 30 günde açılan', value: countText(markets.new30) },
          ]}
        />
      </Group>
      <Group title="Kodlar">
        <Figures
          label="Kodlar"
          columns="sm:grid-cols-5"
          items={[
            { label: 'Üretilen', value: countText(codes.issued) },
            { label: 'Kullanılan', value: countText(codes.used) },
            { label: 'Bekleyen', value: countText(codes.unused) },
            { label: 'Süresi dolan', value: countText(codes.expired) },
            { label: 'İptal', value: countText(codes.revoked) },
          ]}
        />
      </Group>
      <Group title="Cihazlar">
        <Figures
          label="Cihazlar"
          columns="sm:grid-cols-2"
          items={[
            { label: 'Bağlı', value: countText(devices.total) },
            { label: 'Son 24 saatte görülen', value: countText(devices.seenToday) },
          ]}
        />
      </Group>
    </div>
  );
}

function ListHeading({ id, title }: { id: string; title: string }): JSX.Element {
  return (
    <h3 id={id} className="font-display text-label font-semibold">
      {title}
    </h3>
  );
}

function ExpiringCodes({
  overview,
  api,
  notify,
  onChanged,
}: {
  overview: Overview;
  api: OperatorApi;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  async function extend(code: string) {
    setBusy(code);
    setError(undefined);
    try {
      const { expiresAt } = await api.extendCode(code, 30);
      notify(`${code}: son gün ${dayText(expiresAt)}.`);
      onChanged();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section aria-labelledby="expiring-codes" className="flex flex-col gap-3">
      <ListHeading id="expiring-codes" title="Süresi biten kodlar · 7 gün" />
      {error ? <Alert>{error}</Alert> : null}
      {overview.expiringCodes.length === 0 ? (
        <p className="text-text-2">Bu hafta süresi biten kod yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.expiringCodes.map((item) => (
            <li
              key={item.code}
              className="slip flex flex-col gap-2 px-4 py-3 [--slip-edge:var(--color-warning)] sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono font-medium">{item.code}</span>
                <span className="truncate text-sm text-text-2">
                  {`${item.note} · son gün ${dateTimeText(item.expiresAt)}`}
                </span>
              </div>
              <Button
                disabled={busy === item.code}
                aria-label={`${item.code}: 30 gün uzat`}
                onClick={() => void extend(item.code)}
              >
                +30 gün
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const QUICK = [
  { days: 30, label: '+1 ay' },
  { days: 365, label: '+1 yıl' },
] as const;

function PlanDue({
  overview,
  api,
  now,
  notify,
  onOpen,
  onChanged,
}: {
  overview: Overview;
  api: OperatorApi;
  now: Date;
  notify(message: string): void;
  onOpen(marketId: string): void;
  onChanged(): void;
}): JSX.Element {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  async function extend(item: Overview['planDue'][number], days: number) {
    setBusy(item.id);
    setError(undefined);
    // From the date while it runs, from today once it has passed.
    const today = dayInTurkey(now.toISOString());
    const from = item.planUntil > today ? item.planUntil : today;
    const until = addDays(from, days);
    try {
      await api.setPlan(item.id, item.plan ?? '', until);
      notify(`${item.name}: yeni tarih ${dayText(until)}.`);
      onChanged();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section aria-labelledby="plan-due" className="flex flex-col gap-3">
      <ListHeading id="plan-due" title="Paket tarihi yaklaşanlar" />
      <p className="text-meta text-muted">Yalnız hatırlatma; markete hiçbir kısıt getirmez.</p>
      {error ? <Alert>{error}</Alert> : null}
      {overview.planDue.length === 0 ? (
        <p className="text-text-2">Yaklaşan paket tarihi yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.planDue.map((item) => {
            const state = planDateText(item.planUntil, now);
            return (
              <li
                key={item.id}
                className={`slip flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center ${
                  state.tone === 'danger'
                    ? '[--slip-edge:var(--color-danger)]'
                    : '[--slip-edge:var(--color-warning)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="-mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left hover:bg-bg"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{item.name}</span>
                    <span className={`text-sm font-medium ${TONES[state.tone]}`}>
                      {state.text}
                      <span className="font-normal text-text-2">
                        {` · ${dayText(item.planUntil)}${item.plan ? ` · ${item.plan}` : ''}`}
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    size={18}
                    className="ml-auto shrink-0 text-muted"
                  />
                </button>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  {QUICK.map((quick) => (
                    <Button
                      key={quick.days}
                      disabled={busy === item.id}
                      aria-label={`${item.name}: ${quick.label}`}
                      onClick={() => void extend(item, quick.days)}
                    >
                      {quick.label}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Quiet({
  overview,
  now,
  onOpen,
}: {
  overview: Overview;
  now: Date;
  onOpen(marketId: string): void;
}): JSX.Element {
  return (
    <section aria-labelledby="quiet" className="flex flex-col gap-3">
      <ListHeading id="quiet" title="Sessiz marketler · 7 gün" />
      {overview.quiet.length === 0 ? (
        <p className="text-text-2">Cihazı olan her market son 7 günde eşitlendi.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-plate border border-line bg-surface">
          {overview.quiet.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left hover:bg-bg"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
                <span className="shrink-0 text-sm text-text-2">
                  {`Son eşitleme: ${agoText(item.lastSyncAt, now, 'hiç').toLocaleLowerCase('tr')}`}
                </span>
                <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
