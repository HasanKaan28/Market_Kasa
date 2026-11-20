import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastRegion } from './ToastRegion';
import { useToast } from './useToast';

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  it('shows a message and clears it after the duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(1000));
    act(() => result.current.show('Satış tamamlandı'));
    expect(result.current.message).toBe('Satış tamamlandı');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.message).toBeNull();
  });

  it('announces its message politely', () => {
    render(<ToastRegion message="Satış tamamlandı" />);
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Satış tamamlandı');
  });
});
