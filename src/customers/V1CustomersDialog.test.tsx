import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCustomer, customerBalance } from '@/data/customers';
import { renderWithData } from '@/test/renderWithData';
import { V1CustomersDialog } from './V1CustomersDialog';

const backup = {
  backupDate: '2026-10-01T10:00:00.000Z',
  products: [],
  customers: [
    { name: 'Ahmet Yılmaz', phone: '0532 111 22 33', balance: 150.75, limit: 2000 },
    { name: 'Ayşe', balance: 0, limit: 500 },
    { name: '', balance: 10 },
  ],
};

const file = (text: string, name = 'market_pos_yedek_2026-10-01.json') =>
  new File([text], name, { type: 'application/json' });

describe('V1CustomersDialog', () => {
  it('previews a v1 backup before writing', async () => {
    const onDone = vi.fn();
    const { data } = await renderWithData(
      <V1CustomersDialog open onClose={vi.fn()} onDone={onDone} />,
    );
    const dialog = await screen.findByRole('dialog', { name: "v1'den müşteri aktar" });
    await userEvent.upload(within(dialog).getByLabelText('Yedek dosyası'), file('düz metin'));
    expect(
      await within(dialog).findByText(
        "Bu bir v1 yedeği değil. v1'de Ayarlar → Yedek İndir (JSON).",
      ),
    ).toBeInTheDocument();

    await userEvent.upload(
      within(dialog).getByLabelText('Yedek dosyası'),
      file(JSON.stringify(backup)),
    );
    expect(
      await within(dialog).findByText("2 yeni, 0 tekrar, 0 zaten aktarıldı, 0 v2'de var, 1 hatalı"),
    ).toBeInTheDocument();
    const row = within(dialog).getByText('Ahmet Yılmaz').closest('tr')!;
    expect(row).toHaveTextContent('05321112233');
    expect(row).toHaveTextContent('₺150,75');
    expect(row).toHaveTextContent('Yeni');
    expect(within(dialog).getByText('Adı yok.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Aktarılmayan borç/)).toBeNull();
    // Nothing is written until the person says so.
    expect(await data.db.customers.count()).toBe(0);

    await userEvent.click(within(dialog).getByRole('button', { name: '2 müşteriyi aktar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('2 müşteri aktarıldı, 1 atlandı.'));
    const ahmet = (await data.db.customers.toArray()).find((c) => c.name === 'Ahmet Yılmaz')!;
    expect(await customerBalance(data.db, ahmet.id)).toBe(15075);
  });

  it('says how much debt it leaves to the owner', async () => {
    const { data } = await renderWithData(
      <V1CustomersDialog open onClose={vi.fn()} onDone={vi.fn()} />,
    );
    await createCustomer(data.db, { name: 'Ahmet Yılmaz', phone: '05321112233' }, new Date());
    const dialog = await screen.findByRole('dialog', { name: "v1'den müşteri aktar" });
    await userEvent.upload(
      within(dialog).getByLabelText('Yedek dosyası'),
      file(JSON.stringify(backup)),
    );
    expect(
      await within(dialog).findByText(
        "Aktarılmayan borç ₺150,75: bu müşteriler v2'de zaten var. Borçlarını elle ekleyin.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("v2'de var: borç aktarılmaz")).toBeInTheDocument();
  });
});
