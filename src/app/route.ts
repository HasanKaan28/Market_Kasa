import { useSyncExternalStore } from 'react';
import type { Permission } from '@/domain/permissions';

/** The screens this build has; each lives at `#/<route>`, which works offline and from a file. */
export type Route =
  'pos' | 'products' | 'stock' | 'customers' | 'suppliers' | 'invoices' | 'reports' | 'settings';

const ROUTES: readonly Route[] = [
  'pos',
  'products',
  'stock',
  'customers',
  'suppliers',
  'invoices',
  'reports',
  'settings',
];

/** What a person must be allowed to open each screen (DESIGN §8.5); the register is open to all. */
export const ROUTE_PERMISSIONS: Partial<Record<Route, Permission>> = {
  products: 'editProducts',
  stock: 'stock',
  customers: 'collect',
  suppliers: 'suppliers',
  invoices: 'invoice',
  reports: 'reports',
  settings: 'admin',
};

/** The screen an address names; the register for anything else. */
export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\//, '');
  return ROUTES.find((route) => route === name) ?? 'pos';
}

/** The current screen, following the address as links and the back button change it. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
