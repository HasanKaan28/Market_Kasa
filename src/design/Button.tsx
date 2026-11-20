import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { Kbd } from './Kbd';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `md` is a 48 px touch target; `lg` the screen's main action; `icon` a 44 px square. */
  size?: 'md' | 'lg' | 'icon';
  kbd?: string;
  icon?: ReactNode;
};

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'border-transparent bg-accent text-white hover:bg-accent-hover',
  secondary: 'border-line bg-surface text-text hover:border-line-strong',
  ghost: 'border-transparent bg-transparent text-text-2 hover:bg-surface',
  danger: 'border-transparent bg-danger-bg text-danger hover:border-danger',
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  md: 'min-h-touch px-4 text-body',
  lg: 'min-h-14 px-5 font-display text-label tracking-[-0.01em]',
  icon: 'size-11 shrink-0',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  kbd,
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'inline-flex items-center justify-center gap-2 rounded-control border font-semibold select-none',
    'transition-[background-color,border-color,color,transform] duration-150 ease-plate active:scale-[0.97]',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} aria-keyshortcuts={kbd} className={classes} {...rest}>
      {icon}
      {children}
      {/* The shortcut is announced through aria-keyshortcuts, so the visible hint stays out of the name. */}
      {kbd ? (
        <span aria-hidden="true">
          <Kbd>{kbd}</Kbd>
        </span>
      ) : null}
    </button>
  );
}
