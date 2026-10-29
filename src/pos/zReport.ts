import type { CashSessionRecord } from '@/data/types';
import { formatTRY, type Kurus } from '@/domain/money';
import { formatAmount, formatPeriod } from '@/reports/reportFormat';
import { formatTime, PAYMENT_LABELS } from './format';

export type ZReportRow = { label: string; amount: string };

/** A Z report as it prints on receipt paper, every value already written out. */
export type ZReportModel = {
  header: string[];
  device: string;
  dateTime: string;
  /** When the drawer opened, or that it never was, and the business day. */
  opened: string;
  sections: { title: string; rows: ZReportRow[] }[];
};

const CLOSED_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

/** Counted less expected, signed: "+₺5,00" over, "−₺5,00" short, "₺0,00" exact. */
export function formatDifference(difference: Kurus): string {
  return difference > 0 ? `+${formatTRY(difference)}` : formatAmount(difference);
}

/** The Z report of a closed drawer: its sales, how they were paid, their VAT and the cash count. */
export function zReportModel(
  record: CashSessionRecord,
  { marketName, deviceName }: { marketName: string; deviceName: string },
): ZReportModel {
  const { summary, cash } = record;
  const opened = record.openedAt
    ? `Açılış ${formatTime(record.openedAt)}`
    : summary.salesCount > 0
      ? 'Kasa açılmadan satış yapıldı.'
      : 'Kasa açılmadı.';
  // Sales less returns less voids of earlier days make the net; a sale voided within the same Z
  // was never in the sales, so it is shown for the record only, without a minus.
  const sameDayVoids = summary.voidCount - summary.earlierVoidCount;
  const sections = [
    {
      title: 'Satışlar',
      rows: [
        { label: 'İşlem', amount: String(summary.salesCount) },
        { label: 'Satış (iade öncesi)', amount: formatAmount(summary.gross) },
        { label: `İade (${summary.returnCount})`, amount: takenOff(summary.returnTotal) },
        ...(summary.earlierVoidCount > 0
          ? [
              {
                label: `Önceki satış iptali (${summary.earlierVoidCount})`,
                amount: takenOff(summary.earlierVoidTotal),
              },
            ]
          : []),
        { label: 'Net satış', amount: formatAmount(summary.net) },
        { label: 'Verilen indirim', amount: formatAmount(summary.discounts) },
        ...(sameDayVoids > 0
          ? [
              {
                label: `İptal edilen fiş (${sameDayVoids})`,
                amount: formatAmount(summary.voidTotal - summary.earlierVoidTotal),
              },
            ]
          : []),
      ],
    },
    {
      title: 'Ödemeler',
      rows: (['cash', 'card', 'credit'] as const).map((method) => ({
        label: PAYMENT_LABELS[method],
        amount: formatAmount(summary.byMethod[method]),
      })),
    },
    {
      title: 'KDV',
      rows: summary.vatByRate.flatMap(({ rate, base, vat }) => [
        { label: `Matrah %${rate}`, amount: formatAmount(base) },
        { label: `KDV %${rate}`, amount: formatAmount(vat) },
      ]),
    },
    {
      title: 'Kasa',
      rows: [
        { label: 'Açılış nakdi', amount: formatTRY(record.openingCash) },
        { label: 'Nakit satış', amount: formatAmount(cash.sales) },
        { label: 'Nakit iptal', amount: takenOff(cash.voids) },
        { label: 'Nakit iade', amount: takenOff(cash.refunds) },
        { label: 'Para girişi', amount: formatTRY(cash.movementsIn) },
        { label: 'Para çıkışı', amount: takenOff(cash.movementsOut) },
        { label: 'Beklenen', amount: formatAmount(record.expectedCash) },
        { label: 'Sayılan', amount: formatTRY(record.countedCash) },
        { label: 'Fark', amount: formatDifference(record.difference) },
      ],
    },
  ];
  return {
    header: [marketName, 'Z RAPORU'],
    device: `${deviceName} (${record.deviceCode})`,
    dateTime: CLOSED_FORMAT.format(new Date(record.closedAt)),
    opened: `${opened} · İş günü ${formatPeriod(record.businessDate, record.businessDate)}`,
    sections: sections.filter((section) => section.rows.length > 0),
  };
}

/** An amount that came off, shown with its minus; nothing is plain zero. */
function takenOff(amount: Kurus): string {
  return amount === 0 ? formatTRY(0) : formatAmount(-amount);
}
