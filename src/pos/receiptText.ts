import type { ReceiptModel, ReceiptRow } from './receipt';

export type ReceiptColumns = 32 | 48;

/**
 * A receipt as monospaced text, at most `columns` characters per line (32 for 58 mm paper,
 * 48 for 80 mm): for WhatsApp now, and for a receipt printer later. An amount is never cut;
 * a name that does not fit beside it is shortened with "…".
 */
export function receiptText(model: ReceiptModel, columns: ReceiptColumns): string {
  const rule = '-'.repeat(columns);
  const row = ({ label, amount }: ReceiptRow) => twoColumns(label, amount, columns);
  const lines = [
    ...model.header.flatMap((line) => centered(line, columns)),
    twoColumns(model.device, model.dateTime, columns),
    `Fiş ${model.receiptNo}`,
    rule,
    ...model.lines.flatMap((line) => [
      twoColumns(line.name, line.amount, columns),
      `  ${line.detail}`,
      ...(line.discount ? [`  ${line.discount}`] : []),
    ]),
    rule,
    ...model.totals.map(row),
    ...model.vat.map(row),
    rule,
    ...model.payments.map(row),
    ...(model.customer ? [model.customer] : []),
    ...model.marks.map((mark) => `*** ${mark} ***`),
    rule,
    ...model.footer.flatMap((line) => centered(line, columns)),
  ];
  return lines.join('\n');
}

/** A wa.me link with the text; Turkish mobile numbers get the 90 country code. */
export function whatsappLink(text: string, phone?: string): string {
  const number = whatsappNumber(phone ?? '');
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (/^90\d{10}$/.test(digits)) {
    return digits;
  }
  if (/^0\d{10}$/.test(digits)) {
    return `90${digits.slice(1)}`;
  }
  if (/^5\d{9}$/.test(digits)) {
    return `90${digits}`;
  }
  return '';
}

function twoColumns(left: string, right: string, columns: number): string {
  const room = columns - right.length - 1;
  const shown = left.length <= room ? left : `${left.slice(0, Math.max(0, room - 1))}…`;
  return `${shown}${' '.repeat(columns - shown.length - right.length)}${right}`;
}

function centered(text: string, columns: number): string[] {
  return wrapped(text, columns).map(
    (line) => `${' '.repeat(Math.floor((columns - line.length) / 2))}${line}`,
  );
}

function wrapped(text: string, columns: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current === '' ? word : `${current} ${word}`;
    if (next.length <= columns) {
      current = next;
    } else {
      if (current !== '') {
        lines.push(current);
      }
      current = word.slice(0, columns);
    }
  }
  return current === '' ? lines : [...lines, current];
}
