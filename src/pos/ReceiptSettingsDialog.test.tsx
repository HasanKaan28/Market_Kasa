import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReceiptSettingsDialog } from './ReceiptSettingsDialog';
import { DEFAULT_RECEIPT_SETTINGS } from './receiptSettings';

describe('ReceiptSettingsDialog', () => {
  it('saves the chosen settings', async () => {
    const onSave = vi.fn();
    render(
      <ReceiptSettingsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fiş yazdırma' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Satıştan sonra otomatik yazdır' }));
    await userEvent.click(screen.getByRole('radio', { name: '58 mm' }));
    await userEvent.type(screen.getByLabelText('Fiş başlığı'), 'Atatürk Cad. 5');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(onSave).toHaveBeenCalledWith({
      printing: true,
      autoPrint: true,
      paperWidth: 58,
      header: 'Atatürk Cad. 5',
      footer: '',
    });
  });

  it('keeps auto print off while printing is off', () => {
    render(
      <ReceiptSettingsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Satıştan sonra otomatik yazdır' })).toBeDisabled();
  });
});
