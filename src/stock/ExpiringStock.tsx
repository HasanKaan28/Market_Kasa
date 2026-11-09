import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import { expiringLots } from '@/data/expiry';
import { formatStock } from '@/pos/format';

const WITHIN_DAYS = 30;

const istanbulDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' });

/** `2026-11-12` as the shop reads it: `12.11.2026`. */
const shownDate = (date: string) => date.split('-').reverse().join('.');

function whenText(daysLeft: number): string {
  if (daysLeft < 0) {
    return `Geçti (${-daysLeft} gün)`;
  }
  return daysLeft === 0 ? 'Bugün' : `${daysLeft} gün kaldı`;
}

/**
 * Deliveries whose son kullanma tarihi has passed or comes within 30 days and are likely still on
 * the shelf, the soonest first. What is left is an estimate: the oldest delivery is taken to be
 * sold first.
 */
export function ExpiringStock({ now = () => new Date() }: { now?: () => Date }): JSX.Element {
  const { db } = useData();
  const today = istanbulDay.format(now());
  const lots = useLiveQuery(() => expiringLots(db, today, WITHIN_DAYS), [db, today]);

  if (!lots) {
    return <></>;
  }
  if (lots.length === 0) {
    return <p className="text-text-2">30 gün içinde son kullanma tarihi dolan ürün yok.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-2">
        Kalan miktar tahminidir: önce gelen malın önce satıldığı varsayılır.
      </p>
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">SKT yaklaşanlar</caption>
        <thead className="border-b border-line-strong text-sm text-text-2">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Ürün
            </th>
            <th scope="col" className="w-28 py-2 pr-3 font-medium">
              SKT
            </th>
            <th scope="col" className="w-32 py-2 pr-3 font-medium">
              Durum
            </th>
            <th scope="col" className="w-24 py-2 text-right font-medium">
              Kalan
            </th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr
              key={`${lot.productId}-${lot.receivedAt}-${lot.expiresOn}`}
              className="border-b border-line align-top last:border-0"
            >
              <td className="py-3 pr-3 font-medium break-words">{lot.name}</td>
              <td className="py-3 pr-3 font-mono">{shownDate(lot.expiresOn)}</td>
              <td
                className={`py-3 pr-3 ${lot.daysLeft <= 0 ? 'font-medium text-danger' : lot.daysLeft <= 7 ? 'text-accent' : 'text-text-2'}`}
              >
                {whenText(lot.daysLeft)}
              </td>
              <td className="py-3 text-right">{formatStock(lot.remainingMilli, lot.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
