import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectField } from './SelectField';

describe('SelectField', () => {
  it('labels the select, lists its options and reports a choice', async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Kategori"
        hint="Kasadaki gruplar"
        value=""
        onChange={(event) => onChange(event.target.value)}
        options={[
          { value: '', label: 'Kategorisiz' },
          { value: 'c1', label: 'Ekmek' },
        ]}
      />,
    );
    const select = screen.getByLabelText('Kategori');
    expect(select).toHaveAccessibleDescription('Kasadaki gruplar');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Kategorisiz', 'Ekmek']);
    await userEvent.selectOptions(select, 'Ekmek');
    expect(onChange).toHaveBeenCalledWith('c1');
  });
});
