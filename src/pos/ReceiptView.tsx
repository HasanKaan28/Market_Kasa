import type { JSX } from 'react';
import type { ReceiptModel, ReceiptRow } from './receipt';

/** A receipt laid out for paper of the given width; the same layout is printed. */
export function ReceiptView({
  model,
  paperWidth,
}: {
  model: ReceiptModel;
  paperWidth: 58 | 80;
}): JSX.Element {
  return (
    <article
      aria-label={`Fiş ${model.receiptNo}`}
      style={{ width: `${paperWidth}mm` }}
      className="mx-auto flex max-w-full flex-col gap-2 bg-white px-2 py-3 text-[13px] leading-snug text-black"
    >
      <header className="text-center">
        {model.header.map((line, index) => (
          <p key={index} className={index === 0 ? 'text-[15px] font-semibold' : ''}>
            {line}
          </p>
        ))}
      </header>
      <div className="flex justify-between">
        <span>{model.device}</span>
        <span>{model.dateTime}</span>
      </div>
      <p className="font-mono">{`Fiş ${model.receiptNo}`}</p>
      <hr className="border-dashed border-black/40" />
      <ul className="flex flex-col gap-1">
        {model.lines.map((line, index) => (
          <li key={index}>
            <Row label={line.name} amount={line.amount} />
            <p className="pl-2 text-black/70">{line.detail}</p>
            {line.discount ? <p className="pl-2 text-black/70">{line.discount}</p> : null}
          </li>
        ))}
      </ul>
      <hr className="border-dashed border-black/40" />
      <dl>
        {model.totals.map((row) => (
          <Row
            key={row.label}
            label={row.label}
            amount={row.amount}
            strong={row.label === 'Toplam'}
          />
        ))}
        {model.vat.map((row) => (
          <Row key={row.label} label={row.label} amount={row.amount} muted />
        ))}
      </dl>
      <hr className="border-dashed border-black/40" />
      <dl>
        {model.payments.map((row: ReceiptRow) => (
          <Row key={row.label} label={row.label} amount={row.amount} />
        ))}
      </dl>
      {model.customer ? <p>{model.customer}</p> : null}
      {model.marks.map((mark) => (
        <p key={mark} className="text-center font-semibold">
          {`*** ${mark} ***`}
        </p>
      ))}
      <hr className="border-dashed border-black/40" />
      <footer className="text-center text-black/70">
        {model.footer.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </footer>
    </article>
  );
}

function Row({
  label,
  amount,
  strong = false,
  muted = false,
}: {
  label: string;
  amount: string;
  strong?: boolean;
  muted?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex justify-between gap-2 ${strong ? 'text-[15px] font-semibold' : ''} ${muted ? 'text-black/70' : ''}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="font-mono">{amount}</span>
    </div>
  );
}
