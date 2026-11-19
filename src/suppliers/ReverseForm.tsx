import { useState, type JSX } from 'react';
import { Button, TextField } from '@/design';

/** A small label beside a record: "Geri alındı" on one taken back, "Düzeltme" on its correction. */
export function Chip({
  tone,
  children,
}: {
  tone: 'danger' | 'muted';
  children: string;
}): JSX.Element {
  const colors = tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-bg text-text-2';
  return (
    <span
      className={`inline-block rounded-chip px-2 py-0.5 text-sm font-medium no-underline ${colors}`}
    >
      {children}
    </span>
  );
}

/**
 * Asks why a record is taken back before it is: the reason is kept with the reversal, so it is
 * required. `hint` says what the reversal puts back and what it leaves.
 */
export function ReverseForm({
  question,
  hint,
  onConfirm,
  onCancel,
}: {
  /** "Fatura F-77 geri alınsın mı?" */
  question: string;
  hint: string;
  /** Does the reversal; a failure is shown and nothing changed. */
  onConfirm(reason: string): Promise<void>;
  onCancel(): void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (reason.trim() === '') {
      setError('Neden geri alındığını yazın.');
      return;
    }
    setError(undefined);
    setFailure(undefined);
    setBusy(true);
    try {
      await onConfirm(reason);
    } catch {
      setFailure('Geri alınamadı. Hiçbir şey değişmedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Geri al"
      noValidate
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <p className="font-medium">{question}</p>
      <p className="text-sm text-text-2">{hint}</p>
      <TextField
        label="Neden"
        autoFocus
        autoComplete="off"
        value={reason}
        error={error}
        onChange={(event) => setReason(event.target.value)}
      />
      {failure ? (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={busy}>
          Geri al
        </Button>
        <Button onClick={onCancel}>Vazgeç</Button>
      </div>
    </form>
  );
}
