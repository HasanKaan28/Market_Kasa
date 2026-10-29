import type { JSX } from 'react';
import { PRINTABLE_WIDTH } from './printPage';
import type { ZReportModel } from './zReport';

/** A Z report as wide as the printer prints on the given paper; the same layout is printed. */
export function ZReportView({
  model,
  paperWidth,
}: {
  model: ZReportModel;
  paperWidth: 58 | 80;
}): JSX.Element {
  return (
    <article
      aria-label="Z raporu"
      style={{ width: `${PRINTABLE_WIDTH[paperWidth]}mm` }}
      className="mx-auto flex max-w-full flex-col gap-2 bg-white px-2 py-3 text-[13px] leading-snug text-black"
    >
      <header className="text-center">
        {model.header.map((line, index) => (
          <p key={line} className={index === 0 ? 'text-[15px] font-semibold' : 'font-semibold'}>
            {line}
          </p>
        ))}
      </header>
      <div className="flex justify-between gap-2">
        <span>{model.device}</span>
        <span>{model.dateTime}</span>
      </div>
      <p>{model.opened}</p>
      {model.sections.map((section) => (
        <section key={section.title} className="flex flex-col">
          <hr className="mb-2 border-dashed border-black/40" />
          <h2 className="font-semibold">{section.title}</h2>
          <dl>
            {section.rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-2">
                <dt>{row.label}</dt>
                <dd>{row.amount}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </article>
  );
}
