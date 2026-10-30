import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows a way out instead of a blank screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReset = vi.fn();
    const Broken = () => {
      throw new Error('boom');
    };
    render(
      <ErrorBoundary onReset={onReset}>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Bir hata oluştu');
    await userEvent.click(screen.getByRole('button', { name: 'Sepeti temizle ve yeniden başlat' }));
    expect(onReset).toHaveBeenCalled();
  });
});
