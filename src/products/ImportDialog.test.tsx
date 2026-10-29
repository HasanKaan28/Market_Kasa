import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { makeXlsx } from '@/test/xlsx';
import { ImportDialog } from './ImportDialog';

const V1_EXPORT =
  'Barkod;Ürün Adı;Kategori;Alış Fiyatı;Satış Fiyatı;KDV %;Mevcut Stok;Birim;Hızlı Satış\n' +
  '"8690000000017";"Süt 1 L";"Süt";30;42.5;1;12;"Adet";Evet\n' +
  '"8690000000024";"Beyaz Peynir";"Süt";200;320;1;1.5;"Kg";Hayır\n';

function csvFile(text: string, name = 'market_urunler_2026-10-29.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('ImportDialog', () => {
  it('imports a CSV file after mapping and preview', async () => {
    const onDone = vi.fn();
    const { data } = await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={onDone} />);
    await userEvent.upload(screen.getByLabelText('Dosya seç'), csvFile(V1_EXPORT));
    expect(await screen.findByLabelText('Ürün adı')).toHaveDisplayValue(/Ürün Adı/);
    expect(screen.getByLabelText('İlk satır başlık')).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Devam' }));

    expect(
      await screen.findByText('2 yeni, 0 güncellenecek, 0 aynı, 0 hatalı'),
    ).toBeInTheDocument();
    expect(screen.getByText('Yeni kategoriler: Süt')).toBeInTheDocument();
    expect(screen.getByText('İçe aktarmayı tek kasadan yapın.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 ürünü içe aktar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('2 ürün eklendi, 0 ürün güncellendi.'));
    const cheese = (await data.db.products.toArray()).find((p) => p.name === 'Beyaz Peynir');
    expect(cheese).toMatchObject({ unit: 'kg', sellPrice: 32000, buyPrice: 20000 });
    expect(await stockOf(data.db, cheese?.id ?? '')).toBe(1500);
  });

  it('lets the user change a guessed column, also in an Excel file', async () => {
    const file = new File(
      [
        makeXlsx([
          ['Ad', 'Fiyat', 'Yeni fiyat'],
          ['Simit', '15', '17.5'],
        ]),
      ],
      'liste.xlsx',
    );
    const onDone = vi.fn();
    const { data } = await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={onDone} />);
    await userEvent.upload(screen.getByLabelText('Dosya seç'), file);
    const price = await screen.findByLabelText('Satış fiyatı');
    expect(price).toHaveDisplayValue(/Fiyat/);
    await userEvent.selectOptions(price, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Devam' }));
    await userEvent.click(await screen.findByRole('button', { name: '1 ürünü içe aktar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await data.db.products.toArray()).toMatchObject([{ name: 'Simit', sellPrice: 1750 }]);
  });

  it('shows the rows it will not import and why', async () => {
    const text = 'Ürün adı;Satış fiyatı;KDV\nSimit;15;1\nGofret;12;18\n';
    await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Dosya seç'), csvFile(text, 'liste.csv'));
    await userEvent.click(await screen.findByRole('button', { name: 'Devam' }));
    expect(
      await screen.findByText('1 yeni, 0 güncellenecek, 0 aynı, 1 hatalı'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hatalı satırlar: 3')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Gofret/ })).toHaveTextContent(
      'KDV 0, 1, 10 ya da 20 olmalı.',
    );
  });

  it('refuses to count a product with a fractional stock in pieces', async () => {
    const data = createTestData();
    await createProduct(
      data.db,
      { name: 'Beyaz Peynir', unit: 'kg', sellPrice: 32000, vatRate: 1 },
      new Date('2026-10-29T09:00:00Z'),
      { openingStockMilli: 1500 },
    );
    await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={vi.fn()} />, data);
    const file = csvFile('Ürün adı;Birim\nBeyaz Peynir;Adet\n', 'liste.csv');
    await userEvent.upload(screen.getByLabelText('Dosya seç'), file);
    await userEvent.click(await screen.findByRole('button', { name: 'Devam' }));
    expect(await screen.findByRole('row', { name: /Beyaz Peynir/ })).toHaveTextContent(
      'Stok kesirli (1,5 kg); adede çevirmeden önce stoğu düzeltin.',
    );
  });

  it('reads the same file again after it changes', async () => {
    await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={vi.fn()} />);
    const input = screen.getByLabelText('Dosya seç');
    await userEvent.upload(input, csvFile('Ürün adı;Satış fiyatı\nSimit;15\n', 'liste.csv'));
    await screen.findByRole('button', { name: 'Devam' });
    // Cleared, so choosing the corrected file again is a change the browser reports.
    expect(input).toHaveValue('');
  });

  it('says when a file cannot be read', async () => {
    await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={vi.fn()} />);
    const input = screen.getByLabelText('Dosya seç');
    await userEvent.upload(input, new File([new Uint8Array([1, 2, 3])], 'bozuk.xlsx'));
    expect(await screen.findByText('Dosya okunamadı. CSV ya da XLSX seçin.')).toBeInTheDocument();
    await userEvent.upload(input, csvFile('', 'bos.csv'));
    expect(await screen.findByText('Dosya okunamadı. CSV ya da XLSX seçin.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Devam' })).not.toBeInTheDocument();
  });

  it('names an old Excel file and reads a CSV that starts with PK', async () => {
    await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={vi.fn()} />);
    const input = screen.getByLabelText('Dosya seç');
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await userEvent.upload(input, new File([xls], 'eski.xls'));
    expect(
      await screen.findByText(
        'Eski Excel (.xls) dosyası okunamıyor; XLSX ya da CSV olarak kaydedin.',
      ),
    ).toBeInTheDocument();
    const text = 'PK kodu;Ürün adı;Satış fiyatı' + String.fromCharCode(10) + 'A1;Simit;15';
    await userEvent.upload(input, csvFile(text, 'liste.csv'));
    expect(await screen.findByRole('button', { name: 'Devam' })).toBeInTheDocument();
    expect(screen.queryByText('Dosya okunamadı. CSV ya da XLSX seçin.')).not.toBeInTheDocument();
  });

  it('shows the rows with errors and warnings first', async () => {
    const lines = ['Ürün adı;Satış fiyatı;KDV', 'Simit;15;1', 'Gofret;12;18', 'Ayran;10;'];
    await renderWithData(<ImportDialog open onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.upload(
      screen.getByLabelText('Dosya seç'),
      csvFile(lines.join(String.fromCharCode(10)), 'liste.csv'),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Devam' }));
    const table = await screen.findByRole('table', { name: 'Önizleme' });
    const names = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(names).toEqual(['Gofret', 'Ayran', 'Simit']);
  });
});
