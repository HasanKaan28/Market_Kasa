import { useId, useState, type ChangeEvent, type JSX } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import {
  applyV1Customers,
  planV1Customers,
  readV1Backup,
  type V1CustomerPlan,
} from '@/import/v1Backup';
import { decodeText } from '@/products/importFile';

export type V1CustomersDialogProps = {
  open: boolean;
  onClose(): void;
  onDone(message: string): void;
};

const ACTION_LABELS: Record<V1CustomerPlan['action'], string> = {
  create: 'Yeni',
  exists: 'Zaten var',
  error: 'Hatalı',
};
const NOT_A_BACKUP = "Bu bir v1 yedeği değil. v1'de Ayarlar → Yedek İndir (JSON).";

/** Brings v1's customers and what they owed over from a v1 backup, after showing what it will do. */
export function V1CustomersDialog({ open, onClose, onDone }: V1CustomersDialogProps): JSX.Element {
  const { db } = useData();
  const actor = useActor();
  const inputId = useId();
  const [plan, setPlan] = useState<V1CustomerPlan[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setPlan(undefined);
    const backup = readV1Backup(decodeText(new Uint8Array(await file.arrayBuffer())));
    if (!backup) {
      setError(NOT_A_BACKUP);
      return;
    }
    setError(undefined);
    setPlan(await planV1Customers(db, backup));
  }

  async function apply() {
    if (!plan || busy) {
      return;
    }
    setBusy(true);
    try {
      const { created, skipped } = await applyV1Customers(db, plan, new Date(), actor);
      onDone(`${created} müşteri aktarıldı, ${skipped} atlandı.`);
    } catch {
      setError('Aktarılamadı. Hiçbir müşteri eklenmedi.');
      setPlan(undefined);
    } finally {
      setBusy(false);
    }
  }

  const count = (action: V1CustomerPlan['action']) =>
    plan?.filter((row) => row.action === action).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="v1'den müşteri aktar"
      size="lg"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-text">
          Yedek dosyası
        </label>
        <input
          id={inputId}
          type="file"
          accept=".json,application/json"
          aria-describedby={`${inputId}-hint`}
          onChange={(event) => void chooseFile(event)}
          className="min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-base file:mr-3 file:rounded-chip file:border-0 file:bg-bg file:px-3 file:py-1.5 file:font-medium"
        />
        <p id={`${inputId}-hint`} className="text-sm text-muted">
          v1'de Ayarlar → Yedek İndir (JSON). Borçlar "v1'den devreden borç" olarak yazılır; aynı ad
          ve telefonla zaten olan müşteri atlanır.
        </p>
      </div>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {plan ? (
        <div className="flex flex-col gap-3">
          <p className="font-medium">
            {`${count('create')} yeni, ${count('exists')} zaten var, ${count('error')} hatalı`}
          </p>
          <div className="max-h-80 overflow-auto rounded-control border border-line">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <caption className="sr-only">Önizleme</caption>
              <thead>
                <tr className="border-b border-line-strong text-sm text-text-2">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ad
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Telefon
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Borç
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Durum
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.map((row, index) => (
                  <tr key={index} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{row.name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-sm">{row.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatTRY(row.balance)}</td>
                    <td className={`px-3 py-2 ${row.action === 'error' ? 'text-danger' : ''}`}>
                      {row.error ?? ACTION_LABELS[row.action]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-text-2">Aktarmayı tek kasadan, bir kez yapın.</p>
          <Button
            variant="primary"
            size="lg"
            disabled={busy || count('create') === 0}
            onClick={() => void apply()}
          >
            {`${count('create')} müşteriyi aktar`}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
