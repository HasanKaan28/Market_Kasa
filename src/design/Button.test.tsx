import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('defaults to type=button and exposes its shortcut', async () => {
    const onClick = vi.fn();
    render(
      <Button kbd="F2" onClick={onClick}>
        Nakit
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /Nakit/ });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'F2');
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Kart
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
