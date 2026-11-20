import type { JSX } from 'react';
import type { ProductRecord } from '@/data/types';
import { formatTRY } from '@/domain/money';
import { ean13Modules } from './ean13';
import type { LabelKind } from './labels';

/** `2026-11-09` as the shop reads it: `09.11.2026`. */
const shownDate = (date: string) => date.split('-').reverse().join('.');

const priceOf = (product: ProductRecord) =>
  `${formatTRY(product.sellPrice)}${product.unit === 'kg' ? '/kg' : ''}`;

/** The bars of an EAN-13, as wide as the label lets them be. */
function Bars({ modules }: { modules: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 95 30"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: '46mm', height: '14mm', display: 'block', margin: '0 auto' }}
    >
      {Array.from(modules).map((bit, index) =>
        bit === '1' ? <rect key={index} x={index} y={0} width={1} height={30} fill="#000" /> : null,
      )}
    </svg>
  );
}

const LABEL_STYLE = {
  width: '70mm',
  height: '37mm',
  boxSizing: 'border-box',
  padding: '3mm 4mm',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  fontFamily: 'Arial, sans-serif',
  color: '#000',
} as const;

const NAME_STYLE = {
  fontSize: '11pt',
  fontWeight: 600,
  lineHeight: 1.15,
  maxHeight: '2.3em',
  overflow: 'hidden',
} as const;

/**
 * Labels on A4 sticker sheets of 3 × 8, each 70 × 37 mm, as most office label paper is cut.
 * A shelf label puts the price large; a barcode label draws the bars of an EAN-13 and, for any
 * other code, only its digits.
 */
export function LabelSheet({
  kind,
  products,
  printedOn,
}: {
  kind: LabelKind;
  products: readonly ProductRecord[];
  printedOn: string;
}): JSX.Element {
  return (
    <ul
      aria-label="Etiketler"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        width: '210mm',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 70mm)',
        gridAutoRows: '37mm',
        background: '#fff',
      }}
    >
      {products.map((product, index) => {
        const modules = product.barcode ? ean13Modules(product.barcode) : null;
        return (
          <li key={`${product.id}-${index}`} style={{ ...LABEL_STYLE, breakInside: 'avoid' }}>
            {kind === 'shelf' ? (
              <>
                <div style={NAME_STYLE}>{product.name}</div>
                <div style={{ fontSize: '24pt', fontWeight: 700, textAlign: 'right' }}>
                  {priceOf(product)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt' }}>
                  <span>{product.barcode ?? ''}</span>
                  <span>{shownDate(printedOn)}</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ ...NAME_STYLE, fontSize: '9pt' }}>{product.name}</div>
                {modules ? <Bars modules={modules} /> : null}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontSize: '8pt', letterSpacing: '0.5pt' }}>
                    {product.barcode ?? ''}
                  </span>
                  <span style={{ fontSize: '13pt', fontWeight: 700 }}>{priceOf(product)}</span>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
