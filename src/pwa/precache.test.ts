import { describe, expect, it, vi } from 'vitest';
import { precacheList, precachePlugin } from './precache';

describe('precache list', () => {
  it('lists every built file the worker must keep', () => {
    expect(
      precacheList([
        'index.html',
        'assets/index-B0x9.js',
        'assets/browser-Zx1.js',
        'assets/index-C2.css',
        'assets/ibm-plex-sans-latin-400-normal-D.woff2',
        'assets/ibm-plex-sans-latin-ext-400-normal-E.woff2',
        'assets/ibm-plex-sans-latin-400-normal-F.woff',
        'assets/ibm-plex-sans-cyrillic-400-normal-G.woff2',
        'assets/index-B0x9.js.map',
        'sw.js',
      ]),
    ).toEqual([
      './assets/browser-Zx1.js',
      './assets/ibm-plex-sans-latin-400-normal-D.woff2',
      './assets/ibm-plex-sans-latin-ext-400-normal-E.woff2',
      './assets/index-B0x9.js',
      './assets/index-C2.css',
    ]);
  });

  it('writes the list next to the build, lazy chunks and fonts included', () => {
    const emitFile = vi.fn();
    const plugin = precachePlugin();
    const generate = plugin.generateBundle as unknown as (
      this: { emitFile: typeof emitFile },
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    generate.call(
      { emitFile },
      {},
      { 'index.html': {}, 'assets/camera-1.js': {}, 'assets/f-latin-1.woff2': {} },
    );
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'precache.json',
      source: JSON.stringify(['./assets/camera-1.js', './assets/f-latin-1.woff2']),
    });
    expect(plugin.apply).toBe('build');
  });
});
