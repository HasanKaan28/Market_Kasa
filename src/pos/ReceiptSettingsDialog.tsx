import { useId, useState, type FormEvent, type JSX } from 'react';
import { Button, Dialog, TextField } from '@/design';
import { shortLine, shortText, type ReceiptSettings } from './receiptSettings';

export type ReceiptSettingsDialogProps = {
  open: boolean;
  settings: ReceiptSettings;
  /** The market's own name: what the receipt's top line shows while no shop name is set. */
  marketName: string;
  onClose(): void;
  onSave(settings: ReceiptSettings): void;
};

const WIDTHS: readonly ReceiptSettings['paperWidth'][] = [58, 80];

export function ReceiptSettingsDialog({
  open,
  settings,
  marketName,
  onClose,
  onSave,
}: ReceiptSettingsDialogProps): JSX.Element {
  const [draft, setDraft] = useState(settings);
  const headerId = useId();
  const footerId = useId();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      ...draft,
      autoPrint: draft.printing && draft.autoPrint,
      shopName: shortLine(draft.shopName),
      header: shortText(draft.header.trim()),
      footer: shortText(draft.footer.trim()),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Fiş ayarları">
      <form noValidate className="flex flex-col gap-4" onSubmit={save}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={draft.printing}
            onChange={(event) =>
              setDraft({
                ...draft,
                printing: event.target.checked,
                autoPrint: event.target.checked && draft.autoPrint,
              })
            }
            className="size-5 accent-accent"
          />
          Fiş yazdırma
        </label>
        <label
          className={`flex min-h-11 items-center gap-3 ${draft.printing ? 'cursor-pointer' : 'text-muted'}`}
        >
          <input
            type="checkbox"
            checked={draft.autoPrint}
            disabled={!draft.printing}
            onChange={(event) => setDraft({ ...draft, autoPrint: event.target.checked })}
            className="size-5 accent-accent"
          />
          Satıştan sonra otomatik yazdır
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Kâğıt genişliği</legend>
          <div className="grid grid-cols-2 gap-2">
            {WIDTHS.map((width) => (
              <label
                key={width}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-control border border-line-strong font-medium has-checked:border-accent has-checked:bg-accent has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name="paperWidth"
                  checked={draft.paperWidth === width}
                  onChange={() => setDraft({ ...draft, paperWidth: width })}
                  className="sr-only"
                />
                {`${width} mm`}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          label="Dükkân adı"
          hint="Fişin en üstüne yazılır."
          placeholder={marketName}
          value={draft.shopName}
          onChange={(event) => setDraft({ ...draft, shopName: event.target.value })}
        />
        <TextArea
          id={headerId}
          label="Fiş başlığı"
          hint="Adın altına yazılır: adres, telefon; en fazla 3 satır."
          value={draft.header}
          onChange={(header) => setDraft({ ...draft, header })}
        />
        <TextArea
          id={footerId}
          label="Alt bilgi"
          hint="Örneğin: Teşekkür ederiz."
          value={draft.footer}
          onChange={(footer) => setDraft({ ...draft, footer })}
        />
        <Button type="submit" variant="primary" size="lg">
          Kaydet
        </Button>
      </form>
    </Dialog>
  );
}

function TextArea({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-text"
      />
      <p id={`${id}-hint`} className="text-sm text-muted">
        {hint}
      </p>
    </div>
  );
}
