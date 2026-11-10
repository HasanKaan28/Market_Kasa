export type Where = {
  /** A production build; a worker in development would serve stale modules. */
  prod: boolean;
  /** The Android app, which ships its files inside and updates through the store. */
  native: boolean;
  protocol: string;
  hostname: string;
};

/** Browsers allow a worker on https, or on localhost for trying a build. */
export function shouldRegister({ prod, native, protocol, hostname }: Where): boolean {
  if (!prod || native) {
    return false;
  }
  return protocol === 'https:' || (protocol === 'http:' && hostname === 'localhost');
}

/** Installs the worker that keeps the app opening offline; a refusal leaves the app as it was. */
export async function registerServiceWorker(where: Where, version: string): Promise<void> {
  if (!shouldRegister(where) || !('serviceWorker' in navigator)) {
    return;
  }
  try {
    // The version in the address makes each release a new worker with its own cache.
    await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(version)}`, {
      scope: './',
    });
  } catch {
    // Private windows and some policies block workers; the app still runs online.
  }
}
