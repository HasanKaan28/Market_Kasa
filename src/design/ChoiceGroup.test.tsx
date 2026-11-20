import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceGroup } from './ChoiceGroup';

describe('ChoiceGroup', () => {
  it('checks the chosen option and reports a change', async () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup
        legend="Birim"
        name="unit"
        options={[
          { value: 'piece', label: 'Adet' },
          { value: 'kg', label: 'Kilogram' },
        ]}
        value="piece"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Birim' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Adet' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Kilogram' }));
    expect(onChange).toHaveBeenCalledWith('kg');
  });
});
