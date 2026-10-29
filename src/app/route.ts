import { useSyncExternalStore } from 'react';

/** The screens this build has; each lives at `#/<route>`, which works offline and from a file. */
export type Route = 'pos' | 'products';

const ROUTES: readonly Route[] = ['pos', 'products'];

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
