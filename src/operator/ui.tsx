import { Check, Copy, RefreshCw } from 'lucide-react';
import { useId, useState, type ComponentProps, type JSX, type ReactNode } from 'react';
import { Button, Dialog } from '@/design';
import { messageOf } from './api';

export function Alert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p role="alert" className="text-sm font-medium text-danger">
      {children}
    </p>
  );
}

export function Loading(): JSX.Element {
  return (
    <p role="status" className="text-text-2">
      Yükleniyor…
    </p>
  );
}

/** A tab's title with its refresh button. */
export function TabHeading({
  id,
  title,
  onReload,
}: {
  id: string;
  title: string;
  onReload?: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <h2 id={id} className="font-display text-xl font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {onReload ? (
        <Button
          variant="ghost"
          className="ml-auto"
          icon={<RefreshCw aria-hidden="true" size={16} />}
          onClick={onReload}
        >
          Yenile
        </Button>
      ) : null}
    </div>
  );
}

/** A plate on the page with a heading, as the forms are drawn. */
export function Panel({
  title,
  id,
  action,
  tone,
  children,
}: {
  title: string;
  id: string;
  action?: ReactNode;
  tone?: 'danger';
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className={`flex min-w-0 flex-col gap-3 rounded-plate border bg-surface p-4 ${
        tone === 'danger' ? 'border-danger/40' : 'border-line'
      }`}
    >
      <div className="flex min-h-11 items-center gap-3">
        <h3
          id={id}
          className={`font-display text-label font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}
        >
          {title}
        </h3>
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A grid of figures: a big number over its label. */
export function Figures({
  label,
  items,
  columns = 'sm:grid-cols-4',
}: {
  label: string;
  items: { label: string; value: string; tone?: string }[];
  columns?: string;
}): JSX.Element {
  return (
    <dl aria-label={label} className={`grid grid-cols-2 gap-2 ${columns}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 flex-col-reverse gap-1 rounded-plate border border-line bg-surface px-4 py-3"
        >
          <dt className="text-sm text-text-2">{item.label}</dt>
          <dd
            className={`truncate font-display text-2xl font-semibold tabular-nums ${item.tone ?? ''}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Label and value rows of a panel. */
export function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** A labelled multi-line field, drawn like TextField. */
export function TextArea({
  label,
  hint,
  id,
  className,
  ...rest
}: ComponentProps<'textarea'> & { label: string; hint?: string }): JSX.Element {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-semibold text-text">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-describedby={hintId}
        className={[
          'min-h-24 rounded-control border border-line-strong bg-surface px-3.5 py-2.5 text-base text-text placeholder:text-muted',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Copies a text, and says so for two seconds. Without a clipboard the text stays to copy by hand. */
export function CopyButton({
  text,
  label = 'Kopyala',
  variant = 'secondary',
  className,
}: {
  text: string;
  label?: string;
  variant?: 'secondary' | 'ghost';
  className?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, an insecure page): the text stays selectable.
    }
  }
  return (
    <Button
      variant={variant}
      {...(className ? { className } : {})}
      onClick={() => void copy()}
      icon={copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
    >
      {copied ? 'Kopyalandı' : label}
    </Button>
  );
}

/**
 * Asks before a change: the dialog names the market and what will happen; the confirming button
 * does it, "Vazgeç" or closing leaves everything as it was.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  /** Throws to show why it failed; resolves once done. */
  onConfirm(): Promise<void>;
  onClose(): void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(undefined);
          onClose();
        }
      }}
      title={title}
      description={description}
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-2 sm:flex sm:flex-row-reverse">
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={busy}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
      </div>
    </Dialog>
  );
}
