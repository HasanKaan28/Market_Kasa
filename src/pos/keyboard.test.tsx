import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createScanBuffer, looksLikeBarcode, useBarcodeScanner, useShortcuts } from './keyboard';

function feed(
  buffer: ReturnType<typeof createScanBuffer>,
  keys: string[],
  start: number,
  gap: number,
): string | null {
  let result: string | null = null;
  keys.forEach((key, index) => {
    result = buffer.push(key, start + index * gap) ?? result;
  });
  return result;
}

describe('createScanBuffer', () => {
  it('returns a fast burst ending in Enter as a code', () =>
    expect(feed(createScanBuffer(), [...'BRK-0042', 'Enter'], 0, 10)).toBe('BRK-0042'));

  it('ignores slow human typing', () =>
    expect(feed(createScanBuffer(), [...'8690', 'Enter'], 0, 200)).toBeNull());

  it('drops codes shorter than the minimum', () =>
    expect(feed(createScanBuffer(), [...'12', 'Enter'], 0, 5)).toBeNull());
});

describe('looksLikeBarcode', () => {
  it('needs barcode characters and at least one digit', () => {
    expect(['8690000000017', 'BRK-0042'].map(looksLikeBarcode)).toEqual([true, true]);
    expect(['süt', 'cola', '12'].map(looksLikeBarcode)).toEqual([false, false, false]);
  });
});

function fakeClock() {
  const clock = { t: 0, gap: 300, now: () => (clock.t += clock.gap) };
  return clock;
}

function Harness(props: {
  onScan(code: string): void;
  now(): number;
  onClick?(): void;
}): JSX.Element {
  const [value, setValue] = useState('');
  useBarcodeScanner(props.onScan, { now: props.now });
  return (
    <>
      <input aria-label="Ara" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" onClick={props.onClick}>
        Artır
      </button>
    </>
  );
}

describe('useBarcodeScanner', () => {
  it('keeps a scan apart from letters typed slowly before it', async () => {
    const clock = fakeClock();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} now={clock.now} />);
    const field = screen.getByLabelText('Ara');
    await userEvent.type(field, 'sü');
    clock.t += 1000;
    clock.gap = 5;
    await userEvent.type(field, '8690000000017{Enter}');
    expect(onScan).toHaveBeenCalledExactlyOnceWith('8690000000017');
    expect(field).toHaveValue('sü');
  });

  it('reads a scan while a button has focus without clicking it', async () => {
    const clock = fakeClock();
    clock.gap = 5;
    const onScan = vi.fn();
    const onClick = vi.fn();
    render(<Harness onScan={onScan} now={clock.now} onClick={onClick} />);
    screen.getByRole('button', { name: 'Artır' }).focus();
    await userEvent.keyboard('8690000000017{Enter}');
    expect(onScan).toHaveBeenCalledWith('8690000000017');
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('latest render', () => {
  // A key can arrive after React commits a render but before its passive effects run (a busy
  // machine, an update from an IndexedDB result). These probes press keys in that gap.
  it('gives a shortcut to the handler and enabled flag of the latest render', () => {
    const seen: number[] = [];
    function Probe({ count, enabled }: { count: number; enabled: boolean }) {
      useShortcuts({ F2: () => seen.push(count) }, enabled);
      useLayoutEffect(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }));
      }, [count, enabled]);
      return null;
    }
    const { rerender } = render(<Probe count={0} enabled />);
    rerender(<Probe count={1} enabled />);
    rerender(<Probe count={2} enabled={false} />);
    expect(seen).toEqual([1]);
  });

  it('gives a scan to the callback of the latest render', () => {
    const seen: number[] = [];
    const clock = fakeClock();
    clock.gap = 5;
    function Probe({ count }: { count: number }) {
      useBarcodeScanner(() => seen.push(count), { now: clock.now });
      useLayoutEffect(() => {
        for (const key of [...'8690000000017', 'Enter']) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        }
      }, [count]);
      return null;
    }
    const { rerender } = render(<Probe count={0} />);
    rerender(<Probe count={1} />);
    expect(seen).toEqual([1]);
  });
});

describe('useShortcuts', () => {
  it('runs the handler for its key only while enabled', () => {
    const onCash = vi.fn();
    const Probe = ({ enabled }: { enabled: boolean }) => {
      useShortcuts({ F2: onCash }, enabled);
      return null;
    };
    const { rerender } = render(<Probe enabled />);
    fireEvent.keyDown(window, { key: 'F2' });
    rerender(<Probe enabled={false} />);
    fireEvent.keyDown(window, { key: 'F2' });
    expect(onCash).toHaveBeenCalledTimes(1);
  });
});
