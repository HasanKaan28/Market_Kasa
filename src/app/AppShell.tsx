import type { JSX, ReactNode } from 'react';
import type { SyncState } from '@/sync/runner';
import type { Route } from './route';
import { APP_VERSION } from './version';

export type NavKey = Route;

export type AppShellProps = {
  marketName: string;
  deviceName: string;
  staffName?: string;
  syncState: SyncState;
  pendingCount?: number;
  activeNav: NavKey;
  children?: ReactNode;
  /** The register's cart; screens without one get the full width. */
  cart?: ReactNode;
};

// Only screens that exist are listed; each later milestone adds its own.
const NAV_ITEMS: readonly { key: NavKey; label: string }[] = [
  { key: 'pos', label: 'Kasa' },
  { key: 'products', label: 'Ürünler' },
];

export function AppShell({
  marketName,
  deviceName,
  staffName,
  syncState,
  pendingCount = 0,
  activeNav,
  children,
  cart,
}: AppShellProps): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-surface px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-control bg-text text-base font-bold text-white"
          >
            {marketName.charAt(0)}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold">{marketName}</span>
            <span className="text-sm text-muted">{deviceName}</span>
          </div>
        </div>
        <nav aria-label="Ana menü" className="flex flex-wrap gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.key} navKey={item.key} active={item.key === activeNav}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <SyncBadge state={syncState} pendingCount={pendingCount} />
          {staffName ? <span className="text-sm text-text-2">{staffName}</span> : null}
        </div>
      </header>

      <div className="flex flex-1 flex-wrap gap-4 px-5 py-4">
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">{children}</main>
        {cart ? (
          <aside
            aria-label="Sepet"
            className="flex max-w-[460px] flex-[1_1_380px] flex-col rounded-control border border-line bg-surface"
          >
            {cart}
          </aside>
        ) : null}
      </div>

      <footer className="px-5 pb-3 text-sm text-muted">{`v${APP_VERSION}`}</footer>
    </div>
  );
}

function NavLink({
  navKey,
  active,
  children,
}: {
  navKey: NavKey;
  active: boolean;
  children: ReactNode;
}): JSX.Element {
  const stateClasses = active ? 'bg-bg font-semibold text-text' : 'text-text-2 hover:bg-bg';
  return (
    <a
      href={`#/${navKey}`}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center rounded-control px-3.5 no-underline ${stateClasses}`}
    >
      {children}
    </a>
  );
}

const SYNC_STYLES: Record<SyncState, { dot: string; text: string }> = {
  online: { dot: 'bg-success', text: 'text-success' },
  offline: { dot: 'bg-muted', text: 'text-text-2' },
  pending: { dot: 'bg-accent', text: 'text-accent' },
  error: { dot: 'bg-danger', text: 'text-danger' },
};

function SyncBadge({
  state,
  pendingCount,
}: {
  state: SyncState;
  pendingCount: number;
}): JSX.Element {
  const label = {
    online: 'Çevrimiçi',
    offline: 'Çevrimdışı',
    pending: `${pendingCount} işlem bekliyor`,
    error: 'Eşitleme hatası',
  }[state];
  const style = SYNC_STYLES[state];
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm ${style.text}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
}
