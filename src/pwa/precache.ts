import type { Plugin } from 'vite';

/**
 * The built files the service worker keeps at install: every hashed file, not only the page's.
 * Of the fonts only the Latin ones in WOFF2: Turkish needs no other script, and every browser that
 * runs a service worker reads WOFF2.
 */
export function precacheList(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => name.startsWith('assets/') && !name.endsWith('.map'))
    .filter(
      (name) =>
        !/\.(woff2?|ttf)$/.test(name) || (name.endsWith('.woff2') && name.includes('-latin-')),
    )
    .map((name) => `./${name}`)
    .sort();
}

/**
 * Writes precache.json beside the build. The page names only its entry files; the camera's
 * lazily loaded scanner and the fonts named from CSS would otherwise be missing offline until
 * used once online.
 */
export function precachePlugin(): Plugin {
  return {
    name: 'market-kasa-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'precache.json',
        source: JSON.stringify(precacheList(Object.keys(bundle))),
      });
    },
  };
}
