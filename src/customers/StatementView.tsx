import type { JSX } from 'react';
import { formatTRY } from '@/domain/money';
import type { StatementModel } from './printStatement';
import { formatBalance } from './statement';

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

/** A statement as printed on A4: market, whose it is, every entry, and the balance. */
export function StatementView({ model }: { model: StatementModel }): JSX.Element {
  const { party, lines } = model;
  const balance = lines.at(-1)?.balanceAfter ?? 0;
  return (
    <article className="flex flex-col gap-4 text-[12pt] text-black">
      <header className="flex flex-col gap-1">
        <p className="text-[14pt] font-semibold">{model.marketName}</p>
        <h1 className="text-[16pt] font-semibold">{model.title}</h1>
        <p>{party.phone ? `${party.name} · ${party.phone}` : party.name}</p>
        <p>{`Tarih: ${dateFormat.format(model.printedAt)}`}</p>
      </header>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 pr-2">Tarih</th>
            <th className="py-1 pr-2">Açıklama</th>
            <th className="py-1 pr-2 text-right">Tutar</th>
            <th className="py-1 text-right">Bakiye</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ entry, description, balanceAfter }) => (
            <tr key={entry.id} className="border-b border-gray-300">
              <td className="py-1 pr-2">{dateFormat.format(new Date(entry.occurredAt))}</td>
              <td className="py-1 pr-2">{description}</td>
              <td className="py-1 pr-2 text-right">
                {entry.amount < 0 ? `−${formatTRY(-entry.amount)}` : formatTRY(entry.amount)}
              </td>
              <td className="py-1 text-right">{formatBalance(balanceAfter, model.creditLabel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-right font-semibold">{`Bakiye: ${formatBalance(balance, model.creditLabel)}`}</p>
    </article>
  );
}
