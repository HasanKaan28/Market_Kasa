import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';

export type DialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  /** `lg` for a dialog that holds a table, such as an import preview. */
  size?: 'md' | 'lg';
  children: ReactNode;
};

/** A modal dialog: focus stays inside, and Escape, a click outside or "Kapat" closes it. */
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
  // Without a description Radix must be told so, or it warns about a missing one.
  const describedBy = description ? {} : { 'aria-describedby': undefined };
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-text/40" />
        <RadixDialog.Content
          {...describedBy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className={`fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] ${size === 'lg' ? 'max-w-[880px]' : 'max-w-[440px]'} -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-control border border-line bg-surface p-5 shadow-lg`}
        >
          <div className="flex items-start justify-between gap-3">
            <RadixDialog.Title className="pt-2 text-lg font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Kapat"
              className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-bg"
            >
              <X aria-hidden="true" size={20} />
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="text-text-2">{description}</RadixDialog.Description>
          ) : null}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
