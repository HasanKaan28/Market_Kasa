import { useEffect, useLayoutEffect, useRef } from 'react';

export type ScanBuffer = {
  /** The finished code when `key` is the Enter that ends a scan; otherwise `null`. */
  push(key: string, at: number): string | null;
  /** Whether the last Enter ended a burst of at least two scanner-speed keys, code or not. */
  endedBurst(): boolean;
};

type ScanOptions = { maxGapMs?: number; minLength?: number };

type ShortcutKey = 'F1' | 'F2' | 'F4' | 'F8' | 'F9';

const SCAN_CHARACTER = /^[0-9A-Za-z-]$/;
const TYPED_BARCODE = /^[0-9A-Za-z-]{4,32}$/;
const MAX_CODE_LENGTH = 32;
const SHORTCUT_KEYS: ReadonlySet<string> = new Set<ShortcutKey>(['F1', 'F2', 'F4', 'F8', 'F9']);
// Scanners press Shift before capital letters; modifiers are not part of the code.
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'CapsLock',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
]);

/**
 * Tells a barcode scanner from a person: a scanner types every key at most `maxGapMs` after the
 * previous one and ends with Enter (DESIGN §15). A slower key starts a new burst.
 */
export function createScanBuffer({ maxGapMs = 50, minLength = 4 }: ScanOptions = {}): ScanBuffer {
  let code = '';
  let lastAt = Number.NEGATIVE_INFINITY;
  let burstEnter = false;
  return {
    push(key, at) {
      if (MODIFIER_KEYS.has(key)) {
        return null;
      }
      const inBurst = at - lastAt <= maxGapMs;
      lastAt = at;
      burstEnter = false;
      if (key === 'Enter') {
        burstEnter = inBurst && code.length >= 2;
        const scanned = inBurst && code.length >= minLength && code.length <= MAX_CODE_LENGTH;
        const result = scanned ? code : null;
        code = '';
        return result;
      }
      if (!SCAN_CHARACTER.test(key)) {
        code = '';
        return null;
      }
      code = inBurst ? code + key : key;
      return null;
    },
    endedBurst: () => burstEnter,
  };
}

/** Whether text a person typed is meant as a barcode: barcode characters and at least one digit. */
export function looksLikeBarcode(text: string): boolean {
  return TYPED_BARCODE.test(text) && /\d/.test(text);
}

/**
 * Listens for scanner bursts wherever focus is. The scan's Enter is swallowed so it cannot click
 * a focused button or submit a field, and a scan typed into a text field is taken back out of it.
 * Keys are timed by their events: a page busy redrawing runs the handlers late, and timing them
 * there would split one scan into pieces.
 */
export function useBarcodeScanner(
  onScan: (code: string) => void,
  {
    now = pressedAt,
    maxGapMs,
    minLength,
  }: ScanOptions & { now?: (event: KeyboardEvent) => number } = {},
): void {
  // Updated during the commit, so a key that arrives before passive effects run still reaches
  // the callback of the latest render.
  const latest = useRef(onScan);
  useLayoutEffect(() => {
    latest.current = onScan;
  });

  useEffect(() => {
    const buffer = createScanBuffer({ maxGapMs, minLength });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const code = buffer.push(event.key, now(event));
      if (code === null && !(event.key === 'Enter' && buffer.endedBurst())) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // A burst that is no usable code still loses its Enter: it must not click or submit.
      if (code !== null) {
        removeTypedCode(event.target, code);
        latest.current(code);
      }
    };
    // Capture phase: runs before any field's or button's own key handling.
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [now, maxGapMs, minLength]);
}

export function useShortcuts(
  handlers: Partial<Record<ShortcutKey, () => void>>,
  enabled: boolean = true,
): void {
  // Same timing as useBarcodeScanner: handlers and the enabled flag of the latest render.
  const latest = useRef({ handlers, enabled });
  useLayoutEffect(() => {
    latest.current = { handlers, enabled };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      const handler =
        current.enabled && isShortcutKey(event.key) ? current.handlers[event.key] : undefined;
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** When the key was pressed, which the browser stamps on the event as it arrives. */
function pressedAt(event: KeyboardEvent): number {
  return event.timeStamp;
}

function isShortcutKey(key: string): key is ShortcutKey {
  return SHORTCUT_KEYS.has(key);
}

/** Sets the field through the native setter and an input event, so React's onChange sees it. */
function removeTypedCode(target: EventTarget | null, code: string): void {
  if (!(target instanceof HTMLInputElement) || !target.value.endsWith(code)) {
    return;
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(target, target.value.slice(0, -code.length));
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
