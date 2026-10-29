import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import {
  closeCashSession,
  expectedCash,
  openCashSession,
  recordCashMovement,
  type ExpectedCash,
} from '@/data/cash';
import type { CashSessionRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY, type Kurus } from '@/domain/money';
import { formatAmount } from '@/reports/reportFormat';
import { formatDateTime, formatTime } from './format';
import { printZReport } from './printZReport';
import { formatDifference, zReportModel } from './zReport';

export type CashDialogProps = {
  open: boolean;
  /** The receipt paper the Z report prints on. */
  paperWidth: 58 | 80;
  onClose(): void;
  /** The drawer was opened or cash moved: the message to show. */
  onDone(message: string): void;
};

type View =
  | { kind: 'status' }
  | { kind: 'move'; direction: 'in' | 'out' }
  | { kind: 'close' }
  | { kind: 'closed'; record: CashSessionRecord };

/**
 * The register's cash drawer: opening it with the cash counted in, money put in or taken out,
 * and the end of the day, where the counted cash is set against the expected and a Z report kept.
 */
export function CashDialog({ open, paperWidth, onClose, onDone }: CashDialogProps): JSX.Element {
  const { db, settings } = useData();
  const { staff } = useSession();
  const { cutoffMinutes } = useMarketSettings();
  const [view, setView] = useState<View>({ kind: 'status' });
  const cash = useLiveQuery(
    () => expectedCash(db, settings.deviceCode, undefined, { cutoffMinutes }),
    [db, settings.deviceCode, cutoffMinutes],
  );

  function print(record: CashSessionRecord) {
    printZReport(
      zReportModel(record, { marketName: settings.marketName, deviceName: settings.deviceName }),
      paperWidth,
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Kasa">
      {view.kind === 'closed' ? (
        <ClosedView record={view.record} onPrint={() => print(view.record)} onClose={onClose} />
      ) : cash === undefined ? (
        <p className="text-text-2">Yükleniyor…</p>
      ) : view.kind === 'move' ? (
        <MoveForm
          direction={view.direction}
          onSave={async (amount, reason) => {
            await recordCashMovement(
              db,
              {
                deviceCode: settings.deviceCode,
                staffId: staff?.id,
                cutoffMinutes,
                kind: view.direction,
                amount,
                reason,
              },
              new Date(),
            );
            setView({ kind: 'status' });
            const what = view.direction === 'in' ? 'Para girişi' : 'Para çıkışı';
            onDone(`${what} kaydedildi · ${formatTRY(amount)}`);
          }}
          onCancel={() => setView({ kind: 'status' })}
        />
      ) : view.kind === 'close' ? (
        <CloseForm
          cash={cash}
          onSave={async (countedCash) => {
            const record = await closeCashSession(
              db,
              { deviceCode: settings.deviceCode, staffId: staff?.id, cutoffMinutes, countedCash },
              new Date(),
            );
            setView({ kind: 'closed', record });
          }}
          onCancel={() => setView({ kind: 'status' })}
        />
      ) : (
        <StatusView
          cash={cash}
          onOpen={async (openingCash) => {
            await openCashSession(db, { deviceCode: settings.deviceCode, openingCash }, new Date());
            onDone(`Kasa açıldı · ${formatTRY(openingCash)}`);
          }}
          onMove={(direction) => setView({ kind: 'move', direction })}
          onCloseDay={() => setView({ kind: 'close' })}
        />
      )}
    </Dialog>
  );
}

function StatusView({
  cash,
  onOpen,
  onMove,
  onCloseDay,
}: {
  cash: ExpectedCash;
  onOpen(openingCash: Kurus): Promise<void>;
  onMove(direction: 'in' | 'out'): void;
  onCloseDay(): void;
}): JSX.Element {
  const { session } = cash;
  const [text, setText] = useState('');
  const { error, setError, saving, run } = useSaving();

  if (!session) {
    return (
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const amount = text.trim() === '' ? 0 : readAmount(text);
          if (amount === null) {
            setError('Tutarı rakamla girin.');
            return;
          }
          void run(() => onOpen(amount));
        }}
      >
        <p className="text-text-2">Kasa açılmadı.</p>
        <TextField
          label="Açılış nakdi"
          hint="Güne başlarken kasaya konan para; kasa yeniden sayılmaz. Boşsa 0 sayılır."
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={text}
          error={error}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" variant="primary" size="lg" disabled={saving}>
          Kasayı aç
        </Button>
        <Button onClick={onCloseDay}>Gün sonu (Z)</Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-2">
        {`Açık · ${formatTime(session.openedAt)} · Açılış nakdi ${formatTRY(session.openingCash)}`}
      </p>
      <Amount label="Beklenen nakit" value={formatAmount(cash.expected)} large />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => onMove('in')}>Para girişi</Button>
        <Button onClick={() => onMove('out')}>Para çıkışı</Button>
      </div>
      <Button variant="primary" size="lg" onClick={onCloseDay}>
        Gün sonu (Z)
      </Button>
    </div>
  );
}

function MoveForm({
  direction,
  onSave,
  onCancel,
}: {
  direction: 'in' | 'out';
  onSave(amount: Kurus, reason: string): Promise<void>;
  onCancel(): void;
}): JSX.Element {
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [amountError, setAmountError] = useState<string>();
  const [reasonError, setReasonError] = useState<string>();
  const { error, saving, run } = useSaving();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = readAmount(amountText);
    const amountProblem =
      amountText.trim() === ''
        ? 'Tutarı girin.'
        : amount === null || amount <= 0
          ? 'Tutarı rakamla, sıfırdan büyük girin.'
          : undefined;
    const reasonProblem = reason.trim() === '' ? 'Neden gerekli.' : undefined;
    setAmountError(amountProblem);
    setReasonError(reasonProblem);
    if (amountProblem || reasonProblem || amount === null) {
      return;
    }
    void run(() => onSave(amount, reason));
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <h3 className="font-semibold">{direction === 'in' ? 'Para girişi' : 'Para çıkışı'}</h3>
      <TextField
        label="Tutar"
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        value={amountText}
        error={amountError}
        onChange={(event) => setAmountText(event.target.value)}
      />
      <TextField
        label="Neden"
        autoComplete="off"
        placeholder={direction === 'in' ? 'Bozuk para' : 'Ekmekçiye ödeme'}
        value={reason}
        error={reasonError ?? error}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {direction === 'in' ? 'Girişi kaydet' : 'Çıkışı kaydet'}
        </Button>
      </div>
    </form>
  );
}

function CloseForm({
  cash,
  onSave,
  onCancel,
}: {
  cash: ExpectedCash;
  onSave(countedCash: Kurus): Promise<void>;
  onCancel(): void;
}): JSX.Element {
  const [text, setText] = useState('');
  const { error, setError, saving, run } = useSaving();
  const counted = text.trim() === '' ? null : readAmount(text);
  const { session } = cash;
  const unopened = session
    ? null
    : cash.sales > 0
      ? 'Kasa açılmadan satış yapıldı. Açılış nakdi 0 sayıldı.'
      : 'Kasa açılmadı. Açılış nakdi 0 sayıldı.';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim() === '') {
      setError('Sayılan nakdi girin.');
      return;
    }
    if (counted === null) {
      setError('Tutarı rakamla girin.');
      return;
    }
    void run(() => onSave(counted));
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <h3 className="font-semibold">Gün sonu (Z)</h3>
      <p className="text-sm text-text-2">
        {cash.lastCloseAt
          ? `Kapsam: son Z raporundan (${formatDateTime(cash.since)}) bu yana.`
          : `Kapsam: ${formatDateTime(cash.since)} itibarıyla, ilk gün sonu.`}
      </p>
      {unopened ? (
        <p className="rounded-control bg-warning-bg px-3 py-2 text-warning">{unopened}</p>
      ) : null}
      <dl className="flex flex-col gap-1 text-text-2">
        <Line label="Açılış nakdi" value={formatTRY(session?.openingCash ?? 0)} />
        <Line label="Nakit satış" value={formatAmount(cash.sales)} />
        <Line label="Nakit iptal" value={formatAmount(-cash.voids)} />
        <Line label="Nakit iade" value={formatAmount(-cash.refunds)} />
        <Line label="Para girişi" value={formatAmount(cash.movementsIn)} />
        <Line label="Para çıkışı" value={formatAmount(-cash.movementsOut)} />
      </dl>
      <Amount label="Beklenen nakit" value={formatAmount(cash.expected)} large />
      <TextField
        label="Sayılan nakit"
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        value={text}
        error={error}
        onChange={(event) => setText(event.target.value)}
      />
      {counted !== null ? (
        <Amount label="Fark" value={formatDifference(counted - cash.expected)} />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          Z raporunu kaydet
        </Button>
      </div>
    </form>
  );
}

function ClosedView({
  record,
  onPrint,
  onClose,
}: {
  record: CashSessionRecord;
  onPrint(): void;
  onClose(): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="font-semibold text-success">
        Z raporu kaydedildi.
      </p>
      <dl className="flex flex-col gap-1">
        <Line label="Beklenen nakit" value={formatAmount(record.expectedCash)} />
        <Line label="Sayılan nakit" value={formatTRY(record.countedCash)} />
        <Line label="Fark" value={formatDifference(record.difference)} />
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onClose}>Kapat</Button>
        <Button variant="primary" onClick={onPrint}>
          Yazdır
        </Button>
      </div>
    </div>
  );
}

/** A figure named by its label, for a reader and a test alike. */
function Amount({
  label,
  value,
  large = false,
}: {
  label: string;
  value: string;
  large?: boolean;
}): JSX.Element {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex items-baseline justify-between gap-3 rounded-control border border-line px-4 py-3"
    >
      <span id={labelId} className="text-text-2">
        {label}
      </span>
      <span className={`font-semibold proportional-nums ${large ? 'text-3xl' : 'text-xl'}`}>
        {value}
      </span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}

/** An amount typed by a person, or null when it is not one. */
function readAmount(text: string): Kurus | null {
  try {
    return parseTRY(text);
  } catch {
    return null;
  }
}

/** One save at a time, with its error: a double click saves once. */
function useSaving() {
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function run(save: () => Promise<void>) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await save();
    } catch {
      setError('Kaydedilemedi.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return { error, setError, saving, run };
}
