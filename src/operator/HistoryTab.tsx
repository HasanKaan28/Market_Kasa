import { useState, type JSX } from 'react';
import { Button } from '@/design';
import { messageOf, type LogEntry, type OperatorApi } from './api';
import { actionDetail, actionLabel, dateTimeText } from './model';
import { useLoad } from './load';
import { Alert, Loading, TabHeading } from './ui';

const PAGE = 50;

/** Everything changed from the panel, newest first, a page at a time. */
export function HistoryTab({
  api,
  onOpen,
}: {
  api: OperatorApi;
  onOpen(marketId: string): void;
}): JSX.Element {
  const first = useLoad(() => api.history({ limit: PAGE }), 'history');
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [end, setEnd] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const entries = [...(first.data ?? []), ...older];
  const more = !end && (first.data?.length ?? 0) === PAGE;

  async function loadMore() {
    const last = entries.at(-1);
    if (!last) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const page = await api.history({ limit: PAGE, beforeId: last.id });
      setOlder((now) => [...now, ...page]);
      setEnd(page.length < PAGE);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <TabHeading
        id="history"
        title="İşlem geçmişi"
        onReload={() => {
          setOlder([]);
          setEnd(false);
          first.reload();
        }}
      />
      {first.error ? <Alert>{first.error}</Alert> : null}
      {first.data === undefined && !first.error ? <Loading /> : null}
      {first.data?.length === 0 ? <p className="text-text-2">Henüz işlem yapılmadı.</p> : null}
      {entries.length > 0 ? (
        <ol className="flex flex-col divide-y divide-line rounded-plate border border-line bg-surface">
          {entries.map((entry) => {
            const detail = actionDetail(entry.action, entry.details);
            return (
              <li key={entry.id} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{actionLabel(entry.action)}</span>
                  {entry.marketId ? (
                    <button
                      type="button"
                      onClick={() => onOpen(entry.marketId as string)}
                      className="min-h-8 rounded-control text-sm font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {entry.marketName ?? entry.marketId}
                    </button>
                  ) : null}
                </div>
                {detail ? <p className="text-sm break-words text-text-2">{detail}</p> : null}
                <p className="text-meta break-all text-muted">
                  {dateTimeText(entry.at)}
                  {entry.operatorEmail ? ` · ${entry.operatorEmail}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {more ? (
        <Button disabled={busy} onClick={() => void loadMore()}>
          Daha eskiler
        </Button>
      ) : null}
    </section>
  );
}
