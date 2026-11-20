import { useLayoutEffect, useRef } from 'react';

const PROPERTY = '--bottom-bar-h';
/** Each bar on screen, with the media query under which it is a bottom bar (none: always). */
const bars = new Map<HTMLElement, string | undefined>();

/** The tallest bar on screen; a hidden one measures 0. */
function publish(): void {
  const height = Math.max(
    0,
    ...[...bars].map(([bar, media]) =>
      media === undefined || (window.matchMedia?.(media).matches ?? true) ? bar.offsetHeight : 0,
    ),
  );
  const root = document.documentElement;
  if (height > 0) {
    root.style.setProperty(PROPERTY, `${height}px`);
  } else {
    root.style.removeProperty(PROPERTY);
  }
}

/**
 * For a bar fixed or stuck to the bottom of the screen: publishes its height as --bottom-bar-h,
 * so toasts (shape.css) rise above it instead of covering its buttons. `media` names the screens
 * where it sits at the bottom (the tab bar is a side rail on a tablet).
 */
export function useBottomBar<T extends HTMLElement>(media?: string) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) {
      return;
    }
    bars.set(bar, media);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      bars.delete(bar);
      publish();
    };
  }, [media]);
  return ref;
}
