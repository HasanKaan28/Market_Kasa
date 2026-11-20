import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createStaff } from '@/data/staff';
import type { StaffRecord } from '@/data/types';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { asPersonWho } from '@/test/session';
import { ApprovalDialog } from './ApprovalDialog';
import { useApproval } from './useApproval';

/** Two actions that each wait on an approval, and what came of each. */
function TwoAsks() {
  const approval = useApproval();
  const [results, setResults] = useState<string[]>([]);
  const run = (name: string) =>
    void approval
      .confirm('discount', { summary: name })
      .then((approved) => setResults((current) => [...current, `${name}: ${approved}`]));
  return (
    <>
      <button type="button" onClick={() => run('birinci')}>
        Birinci
      </button>
      <button type="button" onClick={() => run('ikinci')}>
        İkinci
      </button>
      <output>{results.join(', ')}</output>
      {approval.dialog}
    </>
  );
}

describe('approvals', () => {
  it('turns down an approval left waiting when another one is asked', async () => {
    await renderWithData(asPersonWho([], <TwoAsks />));
    await userEvent.click(screen.getByRole('button', { name: 'Birinci' }));
    expect(await screen.findByText('birinci')).toBeInTheDocument();
    // The dialog is modal: the second ask comes from the screen, as a scan or a shortcut would.
    screen.getByRole('button', { name: 'İkinci', hidden: true }).click();
    expect(await screen.findByText('birinci: false')).toBeInTheDocument();
    expect(await screen.findByText('ikinci')).toBeInTheDocument();
  });

  it('cannot be closed while the approval is being written down', async () => {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '482100' }, new Date());
    let finish: () => void = () => {};
    const onApproved = vi.fn<(approver: StaffRecord) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    await renderWithData(
      <ApprovalDialog open permission="discount" onApproved={onApproved} onClose={onClose} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    await within(dialog).findByRole('option', { name: 'Kaan · Sahip' });
    await userEvent.type(within(dialog).getByLabelText('PIN'), '482100');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    finish();
  });
});
