import { MessageCircle, Search } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';
import { Button, ChoiceGroup, TextField } from '@/design';
import { messageOf, type ActivationCode, type CodeStatus, type OperatorApi } from './api';
import { CODE_STATUS, codeShareLink, countText, dateTimeText, dayText } from './model';
import { useLoad } from './load';
import { Alert, ConfirmDialog, CopyButton, Loading, TabHeading } from './ui';

/** A validity in days, or a number typed in. */
type Period = number | 'custom';
type StatusFilter = CodeStatus | 'all';
type Issued = { codes: string[]; note: string; days: number };

const PERIODS = [
  { value: 7, label: '7 gün' },
  { value: 30, label: '30 gün' },
  { value: 90, label: '90 gün' },
] as const;
const MAX_BULK = 50;

/**
 * New codes for shops, sent on WhatsApp or copied in bulk, and the latest 500 codes with what
 * became of each, filtered by state and searched by code, note or market.
 */
export function CodesTab({
  api,
  onOpen,
  notify,
}: {
  api: OperatorApi;
  onOpen(marketId: string): void;
  notify(message: string): void;
}): JSX.Element {
  const [issued, setIssued] = useState<Issued>();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const { data: codes, error, reload } = useLoad(() => api.listCodes(), 'codes');
  const needle = query.trim().toLocaleLowerCase('tr');
  const counts = (codes ?? []).reduce<Record<string, number>>((all, code) => {
    all[code.status] = (all[code.status] ?? 0) + 1;
    return all;
  }, {});
  const shown = codes?.filter(
    (code) =>
      (status === 'all' || code.status === status) &&
      (needle === '' ||
        [code.code, code.note, code.marketName ?? '', code.usedByEmail ?? '']
          .join(' ')
          .toLocaleLowerCase('tr')
          .includes(needle)),
  );
  const label = (value: StatusFilter, text: string) =>
    codes ? `${text} (${countText(value === 'all' ? codes.length : (counts[value] ?? 0))})` : text;

  return (
    <>
      <section aria-labelledby="new-code" className="flex flex-col gap-4">
        <TabHeading id="new-code" title="Kod üret" />
        <IssueForm
          api={api}
          onIssued={(next) => {
            setIssued(next);
            reload();
          }}
        />
        {issued ? <IssuedCodes issued={issued} /> : null}
      </section>

      <section aria-labelledby="codes" className="flex flex-col gap-3">
        <TabHeading id="codes" title="Kodlar" onReload={reload} />
        <ChoiceGroup<StatusFilter>
          legend="Durum"
          name="code-status"
          wrap
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: label('all', 'Tümü') },
            { value: 'unused', label: label('unused', 'Bekleyen') },
            { value: 'used', label: label('used', 'Kullanıldı') },
            { value: 'expired', label: label('expired', 'Süresi doldu') },
            { value: 'revoked', label: label('revoked', 'İptal') },
          ]}
        />
        <div className="relative">
          <TextField
            label="Kod ara"
            type="search"
            placeholder="Kod, not ya da market"
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
        {error ? <Alert>{error}</Alert> : null}
        {codes === undefined && !error ? <Loading /> : null}
        {shown?.length === 0 ? (
          <p className="text-text-2">
            {codes?.length === 0 ? 'Henüz kod yok.' : 'Bu aramaya uyan kod yok.'}
          </p>
        ) : null}
        {shown && shown.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-text-2">{`${countText(shown.length)} kod`}</p>
              <CopyButton
                variant="ghost"
                className="ml-auto"
                label="Listedekileri kopyala"
                text={shown.map((code) => `${code.code} · ${code.note}`).join('\n')}
              />
            </div>
            <ul className="flex flex-col gap-2">
              {shown.map((code) => (
                <CodeRow
                  key={code.code}
                  code={code}
                  api={api}
                  onOpen={onOpen}
                  notify={notify}
                  onChanged={reload}
                />
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}

function IssueForm({
  api,
  onIssued,
}: {
  api: OperatorApi;
  onIssued(issued: Issued): void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [period, setPeriod] = useState<Period>(30);
  const [customDays, setCustomDays] = useState('');
  const [count, setCount] = useState('1');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const many = Number(count);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const days = period === 'custom' ? Number(customDays) : period;
    if (!note.trim()) {
      setError('Not yazın: kodun kime verildiği.');
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError('Gün 1–365 arası olmalı.');
      return;
    }
    if (!Number.isInteger(many) || many < 1 || many > MAX_BULK) {
      setError(`Adet 1–${MAX_BULK} arası olmalı.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const codes =
        many === 1
          ? [await api.issueCode(note.trim(), days)]
          : await api.issueCodes(note.trim(), days, many);
      onIssued({ codes, note: note.trim(), days });
      setNote('');
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-plate border border-line bg-surface p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 [&>*]:min-w-0">
        <TextField
          label="Not"
          hint="Kime verildiği: market adı, telefon"
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <TextField
          label="Adet"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_BULK}
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </div>
      <ChoiceGroup<Period>
        legend="Geçerlilik"
        name="period"
        wrap
        value={period}
        onChange={setPeriod}
        options={[...PERIODS, { value: 'custom', label: 'Özel' }]}
      />
      {period === 'custom' ? (
        <TextField
          label="Gün"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={customDays}
          onChange={(event) => setCustomDays(event.target.value)}
        />
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        {Number.isInteger(many) && many > 1 ? `${many} kod üret` : 'Kod üret'}
      </Button>
    </form>
  );
}

function IssuedCodes({ issued }: { issued: Issued }): JSX.Element {
  const [first] = issued.codes;
  const single = issued.codes.length === 1 && first !== undefined;
  return (
    <div
      aria-label={single ? 'Üretilen kod' : 'Üretilen kodlar'}
      className="slip edge-accent flex animate-pop-in flex-col gap-3 p-4"
    >
      <p className="text-sm break-words text-text-2">
        {`${issued.note} · ${issued.days} gün geçerli${single ? '' : ` · ${issued.codes.length} kod`}`}
      </p>
      {single ? (
        <output className="font-mono text-[clamp(1.6rem,8vw,2.25rem)] leading-none font-medium tracking-[0.08em] break-all select-all">
          {first}
        </output>
      ) : (
        <ol className="grid gap-1 font-mono text-body font-medium tracking-wide select-all sm:grid-cols-2">
          {issued.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
      )}
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {single ? (
          <a
            href={codeShareLink(first)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-transparent bg-accent px-4 font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <MessageCircle aria-hidden="true" size={18} />
            WhatsApp’ta gönder
          </a>
        ) : null}
        <CopyButton text={issued.codes.join('\n')} label={single ? 'Kopyala' : 'Tümünü kopyala'} />
      </div>
    </div>
  );
}

function CodeRow({
  code,
  api,
  onOpen,
  notify,
  onChanged,
}: {
  code: ActivationCode;
  api: OperatorApi;
  onOpen(marketId: string): void;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  const [revoking, setRevoking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const status = CODE_STATUS[code.status];
  const open = code.status === 'unused' || code.status === 'expired';

  async function extend() {
    setBusy(true);
    setError(undefined);
    try {
      const { expiresAt } = await api.extendCode(code.code, 30);
      notify(`${code.code}: son gün ${dayText(expiresAt)}.`);
      onChanged();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-plate border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-label font-medium tracking-wide">{code.code}</span>
        <span className={`rounded-chip px-2.5 py-0.5 text-meta font-semibold ${status.tone}`}>
          {status.label}
        </span>
      </div>
      <p className="break-words">{code.note}</p>
      <p className="text-meta text-muted">
        {code.status === 'used' && code.usedAt
          ? `Kullanıldı ${dateTimeText(code.usedAt)}${code.usedByEmail ? ` · ${code.usedByEmail}` : ''}`
          : code.status === 'revoked' && code.revokedAt
            ? `İptal ${dateTimeText(code.revokedAt)} · üretildi ${dateTimeText(code.createdAt)}`
            : `Son gün ${dateTimeText(code.expiresAt)} · üretildi ${dateTimeText(code.createdAt)}`}
      </p>
      {code.marketId ? (
        <div>
          <button
            type="button"
            onClick={() => onOpen(code.marketId as string)}
            className="min-h-11 rounded-control text-sm font-semibold text-accent underline-offset-2 hover:underline"
          >
            {code.marketName ?? code.marketId}
          </button>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {open ? (
        <div className="-ml-2 flex flex-wrap gap-1">
          <Button variant="ghost" disabled={busy} onClick={() => void extend()}>
            +30 gün
          </Button>
          <Button variant="ghost" className="text-danger!" onClick={() => setRevoking(true)}>
            İptal et…
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={revoking}
        title="Kod iptal edilsin mi?"
        description={`${code.code} · ${code.note}: bu kod artık market açamaz.`}
        confirmLabel="İptal et"
        onClose={() => setRevoking(false)}
        onConfirm={async () => {
          await api.revokeCode(code.code);
          notify('Kod iptal edildi.');
          onChanged();
        }}
      />
    </li>
  );
}
