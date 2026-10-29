import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

/** Opens a dialog from a button; the dialog is mounted only while it is open, as screens do. */
function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Simit
      </button>
      {open ? (
        <Dialog open onOpenChange={setOpen} title="Ürünü düzenle">
          <input aria-label="Ürün adı" />
        </Dialog>
      ) : null}
    </>
  );
}

describe('Dialog', () => {
  it('is named by its title and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Nakit ödeme">
        <p>İçerik</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Nakit ödeme' })).toHaveTextContent('İçerik');
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes from its close button', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Yeni ürün">
        <p>İçerik</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('gives focus back to what opened it', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Simit' });
    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Ürünü düzenle' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
