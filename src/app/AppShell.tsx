import {
  Boxes,
  ChartColumn,
  Lock,
  Package,
  ReceiptText,
  ScanBarcode,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Button, Logo, useBottomBar } from '@/design';
import type { SyncState } from '@/sync/runner';
import { LicenseBanner } from './LicenseBanner';
import { ROUTE_PERMISSIONS, type Route } from './route';
import { useSession } from './session';
import { SwitchPerson } from './SwitchPerson';
import { APP_VERSION } from './version';

export type NavKey = Route;

export type AppShellProps = {
  marketName: string;
  deviceName: string;
  staffName?: string;
  syncState: SyncState;
  pendingCount?: number;
  /** Why the last sync failed, shown instead of the generic error label. */
  syncError?: string;
  activeNav: NavKey;
  children?: ReactNode;
  /** The register's cart; screens without one get the full width. */
  cart?: ReactNode;
};

type NavItem = { key: NavKey; label: string; icon: LucideIcon };

// Only screens that exist are listed; each later milestone adds its own.
const NAV_ITEMS: readonly NavItem[] = [
  { key: 'pos', label: 'Kasa', icon: ScanBarcode },
  { key: 'products', label: 'Ürünler', icon: Package },
  { key: 'stock', label: 'Stok', icon: Boxes },
  { key: 'customers', label: 'Müşteriler', icon: Users },
  { key: 'suppliers', label: 'Tedarikçiler', icon: Truck },
  { key: 'invoices', label: 'Faturalar', icon: ReceiptText },
  { key: 'reports', label: 'Raporlar', icon: ChartColumn },
  { key: 'settings', label: 'Ayarlar', icon: Settings },
];

const PHONE = '(max-width: 767px)';

/**
 * The frame around every screen. A phone gets one header row and a menu bar under the thumb
 * (it scrolls sideways when the screens do not fit); a tablet a rail of icons on the left; a
 * desktop the same rail with its labels beside the icons.
 */
export function AppShell({
  marketName,
  deviceName,
  staffName,
  syncState,
  pendingCount = 0,
  syncError,
  activeNav,
  children,
  cart,
}: AppShellProps): JSX.Element {
  const session = useSession();
  const shownStaff = staffName ?? session.staff?.name;
  const navRef = useBottomBar<HTMLElement>(PHONE);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)] md:px-6">
        <Logo className="size-8" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-display text-base font-semibold tracking-[-0.01em]">
            {marketName}
          </span>
          <span className="truncate text-meta text-muted">{deviceName}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-3">
          <SyncBadge state={syncState} pendingCount={pendingCount} error={syncError} />
          {shownStaff ? <StaffName name={shownStaff} /> : null}
          {session.staff === null ? null : session.requirePin ? (
            <Button
              variant="ghost"
              className="max-md:size-11 max-md:min-h-0 max-md:px-0"
              icon={<Lock aria-hidden="true" size={18} strokeWidth={1.75} />}
              onClick={session.signOut}
            >
              <span className="max-md:sr-only">Kilitle</span>
            </Button>
          ) : (
            // Without PINs there is nothing to lock: the person at the register is switched.
            <SwitchPerson />
          )}
        </div>
      </header>
      <LicenseBanner />

      <div className="flex flex-1 md:flex-row">
        <nav
          ref={navRef}
          aria-label="Ana menü"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:w-24 md:shrink-0 md:border-t-0 md:border-r md:pb-0 xl:w-56"
        >
          <div className="flex overflow-x-auto [scrollbar-width:none] md:sticky md:top-0 md:flex-col md:gap-1 md:overflow-visible md:px-2 md:py-3 xl:px-3">
            {NAV_ITEMS.filter((item) => {
              const needed = ROUTE_PERMISSIONS[item.key];
              return needed === undefined || session.can(needed);
            }).map((item) => (
              <NavLink key={item.key} item={item} active={item.key === activeNav} />
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col max-md:pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-1 flex-wrap gap-4 px-4 py-4 md:px-6 md:py-5 xl:px-8">
            <main className="flex min-w-0 flex-[999_1_460px] flex-col gap-4">{children}</main>
            {cart ? (
              <aside
                aria-label="Sepet"
                className="slip edge-accent flex max-w-[460px] min-w-0 flex-[1_1_380px] flex-col"
              >
                {cart}
              </aside>
            ) : null}
          </div>
          <footer className="px-4 pb-3 text-meta text-muted md:px-6 xl:px-8">{`v${APP_VERSION}`}</footer>
        </div>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }): JSX.Element {
  const Icon = item.icon;
  // On a phone the bar scrolls sideways: the open screen's tab is brought into view.
  const ref = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, [active]);
  return (
    <a
      ref={ref}
      href={`#/${item.key}`}
      aria-current={active ? 'page' : undefined}
      className={`group flex min-h-16 min-w-[4.75rem] flex-1 shrink-0 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-center text-[11.5px] leading-tight no-underline md:min-h-[4.5rem] md:flex-none md:rounded-control xl:min-h-12 xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-body ${
        active ? 'font-semibold text-text xl:bg-bg' : 'font-medium text-text-2 hover:text-text'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-8 w-14 items-center justify-center rounded-chip transition-colors xl:w-auto xl:bg-transparent ${
          active ? 'bg-bg text-accent' : ''
        }`}
      >
        <Icon size={22} strokeWidth={1.75} />
      </span>
      {item.label}
    </a>
  );
}

/** The signed-in person: their name, and on a phone their initials in a small disc. */
function StaffName({ name }: { name: string }): JSX.Element {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr'))
    .join('');
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-chip bg-bg text-meta font-semibold text-text-2 md:hidden"
      >
        {initials}
      </span>
      <span className="text-sm text-text-2 max-md:sr-only">{name}</span>
    </>
  );
}

const SYNC_STYLES: Record<SyncState, { dot: string; text: string }> = {
  online: { dot: 'bg-success', text: 'text-success' },
  offline: { dot: 'bg-muted', text: 'text-text-2' },
  pending: { dot: 'bg-accent', text: 'text-accent' },
  error: { dot: 'bg-danger', text: 'text-danger' },
};

/** The sync state; a phone shows only its dot until tapped, the label is always read out. */
function SyncBadge({
  state,
  pendingCount,
  error,
}: {
  state: SyncState;
  pendingCount: number;
  error?: string;
}): JSX.Element {
  const [shown, setShown] = useState(false);
  const queued = pendingCount > 0 ? `${pendingCount} işlem bekliyor` : undefined;
  const label = {
    online: 'Çevrimiçi',
    offline: queued ? `Çevrimdışı · ${queued}` : 'Çevrimdışı',
    pending: queued ?? 'Eşitleniyor',
    error: error ?? 'Eşitleme hatası',
  }[state];
  const style = SYNC_STYLES[state];
  return (
    <button
      type="button"
      aria-expanded={shown}
      onClick={() => setShown((now) => !now)}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-chip text-sm md:pointer-events-none md:min-h-9 md:border md:border-line md:px-3 ${
        shown ? 'max-md:border max-md:border-line max-md:px-3' : ''
      } ${style.text}`}
    >
      <span role="status" className="inline-flex items-center gap-2">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${style.dot}`} />
        <span title={label} className={`max-w-56 truncate ${shown ? '' : 'max-md:sr-only'}`}>
          {label}
        </span>
      </span>
    </button>
  );
}
