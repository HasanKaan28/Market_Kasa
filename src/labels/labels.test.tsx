import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct, updateProduct } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { makeTestDb } from '@/test/db';
import { LabelSheet } from './LabelSheet';
import { expandLabels, priceChangedOn } from './labels';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const actor = { deviceCode: 'K1' };
const morning = new Date('2026-11-09T07:00:00Z');

describe('priceChangedOn', () => {
  it('finds the products whose price changed that day, once each, by name', async () => {
    const milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, morning);
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, morning);
    await createProduct(db, { name: 'Un', sellPrice: 3000, vatRate: 1 }, morning);
    await updateProduct(db, milk.id, { sellPrice: 4500 }, morning, actor);
    await updateProduct(db, milk.id, { sellPrice: 4600 }, morning, actor);
    await updateProduct(db, tea.id, { sellPrice: 9500 }, morning, actor);
    // The label carries the name as it is now.
    await updateProduct(db, tea.id, { name: 'Çay 1 kg' }, morning, actor);

    const changed = await priceChangedOn(db, '2026-11-09');
    expect(changed.map((product) => product.name)).toEqual(['Çay 1 kg', 'Süt']);
    expect(await priceChangedOn(db, '2026-11-08')).toEqual([]);
  });
});

describe('expandLabels', () => {
  it('repeats each product by its copies, up to a limit', () => {
    const a = { id: 'a' } as ProductRecord;
    const b = { id: 'b' } as ProductRecord;
    expect(
      expandLabels([
        { product: a, copies: 2 },
        { product: b, copies: 1 },
      ]).map((product) => product.id),
    ).toEqual(['a', 'a', 'b']);
    expect(expandLabels([{ product: a, copies: 999 }])).toHaveLength(240);
  });
});

describe('LabelSheet', () => {
  const cheese = {
    id: 'c',
    name: 'Kaşar',
    barcode: '4006381333931',
    unit: 'kg',
    sellPrice: 40000,
  } as ProductRecord;
  const bread = { id: 'b', name: 'Ekmek', unit: 'piece', sellPrice: 1500 } as ProductRecord;

  it('prints a shelf label with the name, the price per kilo and the day', () => {
    render(<LabelSheet kind="shelf" products={[cheese]} printedOn="2026-11-09" />);
    const label = screen.getByRole('listitem');
    expect(label).toHaveTextContent('Kaşar');
    expect(label).toHaveTextContent('₺400,00/kg');
    expect(label).toHaveTextContent('09.11.2026');
  });

  it('draws the bars of an EAN-13, and only the digits of any other code', () => {
    render(<LabelSheet kind="barcode" products={[cheese, bread]} printedOn="2026-11-09" />);
    const [withBars, without] = screen.getAllByRole('listitem');
    expect(withBars?.querySelector('svg rect')).not.toBeNull();
    expect(withBars).toHaveTextContent('4006381333931');
    expect(without?.querySelector('svg')).toBeNull();
    expect(without).toHaveTextContent('Ekmek');
    expect(without).toHaveTextContent('₺15,00');
  });
});
