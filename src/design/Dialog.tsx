import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

export type DialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  /** `lg` for a dialog that holds a table, such as an import preview. */
  size?: 'md' | 'lg';
  children: ReactNode;
};

/** How far a sheet is pulled down before letting go closes it. */
const CLOSE_DISTANCE_PX = 96;

/**
 * A modal dialog: a sheet from the bottom on a phone, in the thumb's reach, and a centred plate
 * on wider screens. Focus stays inside; Escape, a click outside, "Kapat" or pulling the sheet
 * down closes it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
}: DialogProps): JSX.Element {
  // Radix gives focus back only to its own trigger. These dialogs open from a row, a shortcut or
  // a scan, so the element that had focus is kept (before Radix moves focus inside) and refocused.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);
  const sheet = useRef<HTMLDivElement | null>(null);
  const drag = usePullToClose(sheet, () => onOpenChange(false));
  // Without a description Radix must be told so, or it warns about a missing one.
  const describedBy = description ? {} : { 'aria-describedby': undefined };
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-text/40" />
        <RadixDialog.Content
          ref={sheet}
          {...describedBy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className={[
            'fixed inset-x-0 bottom-0 z-40 flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-sheet border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-lg',
            'sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-48px)] sm:w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-pop-in sm:rounded-plate sm:border sm:pb-0',
            size === 'lg' ? 'sm:max-w-[880px]' : 'sm:max-w-[440px]',
          ].join(' ')}
        >
          <div
            className="flex shrink-0 touch-none flex-col px-5 pt-2 sm:touch-auto sm:pt-4"
            onPointerDown={drag.start}
            onPointerMove={drag.move}
            onPointerUp={drag.end}
            onPointerCancel={drag.cancel}
          >
            <span
              aria-hidden="true"
              className="mx-auto mb-1 h-1.5 w-10 rounded-chip bg-line-strong sm:hidden"
            />
            <div className="flex items-start justify-between gap-3">
              <RadixDialog.Title className="pt-2.5 font-display text-xl font-semibold tracking-[-0.01em]">
                {title}
              </RadixDialog.Title>
              <RadixDialog.Close
                aria-label="Kapat"
                className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-text-2 hover:bg-bg"
              >
                <X aria-hidden="true" size={20} strokeWidth={1.75} />
              </RadixDialog.Close>
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">
            {description ? (
              <RadixDialog.Description className="text-text-2">
                {description}
              </RadixDialog.Description>
            ) : null}
            {children}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Lets a phone's sheet be pulled down by its top to close, as native sheets are. */
function usePullToClose(sheet: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const origin = useRef<number | null>(null);

  function setOffset(px: number) {
    sheet.current?.style.setProperty('transform', px > 0 ? `translateY(${px}px)` : '');
  }

  return {
    start(event: ReactPointerEvent<HTMLElement>) {
      const phone = window.matchMedia?.('(max-width: 639px)').matches ?? false;
      const onButton = event.target instanceof Element && event.target.closest('button') !== null;
      if (!phone || event.pointerType === 'mouse' || onButton) {
        return;
      }
      origin.current = event.clientY;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    move(event: ReactPointerEvent<HTMLElement>) {
      if (origin.current !== null) {
        setOffset(event.clientY - origin.current);
      }
    },
    end(event: ReactPointerEvent<HTMLElement>) {
      if (origin.current === null) {
        return;
      }
      const pulled = event.clientY - origin.current;
      origin.current = null;
      setOffset(0);
      if (pulled > CLOSE_DISTANCE_PX) {
        onClose();
      }
    },
    cancel() {
      origin.current = null;
      setOffset(0);
    },
  };
}
