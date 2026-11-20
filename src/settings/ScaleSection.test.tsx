import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMarketSettings } from '@/data/settings';
import { DEFAULT_SCALE } from '@/domain/scaleBarcode';
import { disposeTestData, renderWithData } from '@/test/renderWithData';
import { ScaleSection } from './ScaleSection';

afterEach(disposeTestData);

describe('ScaleSection', () => {
  it('shows the common label format until the shop changes it', async () => {
    await renderWithData(<ScaleSection onDone={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Terazi barkodunu oku' })).toBeChecked();
    expect(screen.getByLabelText('Ön ekler')).toHaveValue('27, 28, 29');
    expect(screen.getByLabelText('Ürün kodu')).toHaveValue('5');
    expect(screen.getByLabelText('Barkoddaki değer')).toHaveValue('weight');
  });

  it('saves the scale’s label format for every register', async () => {
    const onDone = vi.fn();
    const { data } = await renderWithData(<ScaleSection onDone={onDone} />);
    const prefixes = screen.getByLabelText('Ön ekler');
    await userEvent.clear(prefixes);
    await userEvent.type(prefixes, '28');
    await userEvent.selectOptions(screen.getByLabelText('Ürün kodu'), '4');
    await userEvent.selectOptions(screen.getByLabelText('Barkoddaki değer'), 'price');
    await userEvent.click(screen.getByRole('button', { name: 'Terazi ayarını kaydet' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Terazi ayarı kaydedildi.'));
    expect((await loadMarketSettings(data.db)).scale).toEqual({
      enabled: true,
      prefixes: ['28'],
      codeDigits: 4,
      value: 'price',
    });
  });

  it('refuses a prefix a scale never prints', async () => {
    const onDone = vi.fn();
    const { data } = await renderWithData(<ScaleSection onDone={onDone} />);
    const prefixes = screen.getByLabelText('Ön ekler');
    await userEvent.clear(prefixes);
    await userEvent.type(prefixes, '86');
    await userEvent.click(screen.getByRole('button', { name: 'Terazi ayarını kaydet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ön ekler 20 ile 29 arasında iki haneli olmalı (ör. 27, 28).',
    );
    expect(onDone).not.toHaveBeenCalled();
    expect((await loadMarketSettings(data.db)).scale).toEqual(DEFAULT_SCALE);
  });
});
