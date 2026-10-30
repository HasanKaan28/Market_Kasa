import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Printer } from 'lucide-react';
import { useId, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { AppShell } from '@/app/AppShell';
import { Button, ChoiceGroup, SelectField, TextField } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { downloadText } from '@/products/exportCsv';
import { periodOf, type PeriodChoice } from './period';
import { printReport } from './printReport';
import { soldProductsCsv } from './reportCsv';
import { formatPeriod, reportFigures, type Figure } from './reportFormat';
import { ReportTables } from './ReportTables';
import { loadSummary, reportRegisters, type Summary } from './summary';

type Choice = PeriodChoice | 'custom';

const PERIODS: readonly { value: Choice; label: string }[] = [
  { value: 'today', label: 'Bugün' },
  { value: 'yesterday', label: 'Dün' },
  { value: 'week', label: 'Bu hafta' },
  { value: 'month', label: 'Bu ay' },
  { value: 'custom', label: 'Özel' },
];

/** The register choice that means every register. */
const ALL = '';

/** Sales reports: the figures of a range of business days, for one register or all of them. */
export function ReportsScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const session = useSession();
  const seeCost = session.can('seeCost');
  const status = useSyncStatus(runner);
  const [choice, setChoice] = useState<Choice>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [register, setRegister] = useState(ALL);
  const { cutoffMinutes } = useMarketSettings();
  const today = businessDate(new Date(), { cutoffMinutes });
  const { from, to } = choice === 'custom' ? customRange(custom, today) : periodOf(choice, today);
  const summary = useLiveQuery(
    () => loadSummary(db, { from, to, ...(register === ALL ? {} : { deviceCode: register }) }),
    [db, from, to, register],
  );
  const registers = useLiveQuery(() => reportRegisters(db), [db]);
  const registerOptions = [
    { value: ALL, label: 'Tümü' },
    ...[...new Set([...(registers ?? []), settings.deviceCode])].sort().map((code) => ({
      value: code,
      label: code === settings.deviceCode ? `${code} · ${settings.deviceName}` : code,
    })),
  ];
  const registerLabel =
    registerOptions.find((option) => option.value === register)?.label ?? register;

  // A custom range starts from the days on screen, so it only needs the end that changes.
  function choose(next: Choice) {
    if (next === 'custom' && choice !== 'custom') {
      setCustom({ from, to });
    }
    setChoice(next);
  }

  function exportCsv(shown: Summary) {
    downloadText(`satislar-${from}-${to}.csv`, soldProductsCsv(shown));
  }

  function print(shown: Summary) {
    printReport({
      marketName: settings.marketName,
      from,
      to,
      register: registerLabel,
      summary: shown,
      showCost: seeCost,
      printedAt: new Date(),
    });
  }

  const [hero, ...figures] = summary ? reportFigures(summary, { cost: seeCost }) : [];

  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      activeNav="reports"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Raporlar</h1>
          <p className="text-sm text-text-2">{`${formatPeriod(from, to)} · ${registerLabel}`}</p>
        </div>
        {session.can('admin') ? (
          <Button
            icon={<Download aria-hidden="true" size={18} />}
            disabled={!summary}
            onClick={() => summary && exportCsv(summary)}
          >
            CSV indir
          </Button>
        ) : null}
        <Button
          icon={<Printer aria-hidden="true" size={18} />}
          disabled={!summary}
          onClick={() => summary && print(summary)}
        >
          Yazdır
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[3_1_440px]">
          <ChoiceGroup
            legend="Dönem"
            name="reportPeriod"
            options={PERIODS}
            value={choice}
            onChange={choose}
          />
        </div>
        <div className="flex-[1_1_180px]">
          <SelectField
            label="Kasa"
            options={registerOptions}
            value={register}
            onChange={(event) => setRegister(event.target.value)}
          />
        </div>
      </div>
      {choice === 'custom' ? (
        <div className="flex flex-wrap gap-3">
          <TextField
            label="Başlangıç"
            type="date"
            max={today}
            value={custom.from}
            onChange={(event) => setCustom({ ...custom, from: event.target.value })}
          />
          <TextField
            label="Bitiş"
            type="date"
            max={today}
            value={custom.to}
            onChange={(event) => setCustom({ ...custom, to: event.target.value })}
          />
        </div>
      ) : null}
      {summary && hero ? (
        <>
          <section aria-label="Özet" className="flex flex-wrap gap-3">
            <FigureTile figure={hero} hero />
            <div className="grid flex-[2_1_420px] grid-cols-2 gap-3 sm:grid-cols-3">
              {figures.map((figure) => (
                <FigureTile key={figure.label} figure={figure} />
              ))}
            </div>
          </section>
          {summary.salesCount + summary.returnCount + summary.voidCount === 0 ? (
            <p className="text-text-2">Bu dönemde satış yok.</p>
          ) : (
            <ReportTables summary={summary} />
          )}
        </>
      ) : (
        <p className="text-text-2">Yükleniyor…</p>
      )}
    </AppShell>
  );
}

/** The days a custom range covers; an empty end is today, and ends given backwards are swapped. */
function customRange(custom: { from: string; to: string }, today: string) {
  const from = custom.from || today;
  const to = custom.to || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** One headline figure, its label naming the group; the first is drawn large. */
function FigureTile({ figure, hero = false }: { figure: Figure; hero?: boolean }): JSX.Element {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={`flex flex-col rounded-control border border-line bg-surface ${
        hero ? 'flex-[1_1_260px] justify-center gap-2 p-5' : 'gap-1 p-4'
      }`}
    >
      <span id={labelId} className="text-sm text-text-2">
        {figure.label}
      </span>
      <span
        className={`font-semibold proportional-nums [overflow-wrap:anywhere] ${
          hero ? 'text-4xl md:text-5xl' : 'text-2xl'
        }`}
      >
        {figure.value}
      </span>
      {figure.note ? <span className="text-sm text-muted">{figure.note}</span> : null}
    </div>
  );
}
