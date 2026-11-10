import type { JSX } from 'react';

/** The Market Kasa mark (public/logo.svg, from branding/mark.svg); decorative beside a name. */
export function Logo({ className = 'size-9' }: { className?: string }): JSX.Element {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.svg`}
      alt=""
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    />
  );
}
