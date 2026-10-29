import type { JSX } from 'react';
import type { ReportModel } from './printReport';
import { formatPeriod, reportFigures } from './reportFormat';
import { ReportTables } from './ReportTables';

const printedFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

/** A sales report as printed on A4: the period, the headline figures and the breakdowns. */
export function ReportView({ model }: { model: ReportModel }): JSX.Element {
  return (
    <article className="flex flex-col gap-4 text-[11pt] text-black">
      <header className="flex flex-col gap-1">
        <p className="text-[14pt] font-semibold">{model.marketName}</p>
        <h1 className="text-[16pt] font-semibold">Satış raporu</h1>
        <p>{`Dönem: ${formatPeriod(model.from, model.to)} · Kasa: ${model.register}`}</p>
        <p>{`Yazdırıldı: ${printedFormat.format(model.printedAt)}`}</p>
      </header>
      <dl className="grid grid-cols-2 gap-x-8">
        {reportFigures(model.summary, { cost: model.showCost }).map((figure) => (
          <div
            key={figure.label}
            className="flex justify-between gap-4 border-b border-gray-300 py-1"
          >
            <dt>{figure.label}</dt>
            <dd className="text-right font-semibold">
              {figure.note ? `${figure.value} (${figure.note})` : figure.value}
            </dd>
          </div>
        ))}
      </dl>
      <ReportTables summary={model.summary} />
    </article>
  );
}
