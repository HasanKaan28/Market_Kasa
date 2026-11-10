import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('platform configuration', () => {
  it('keeps Android backups off', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).not.toContain('android:allowBackup="true"');
  });

  it('links a manifest that names the app', () => {
    const manifest = JSON.parse(read('public/manifest.json')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: 'Market Kasa',
      short_name: 'Market Kasa',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#F5F6F8',
      background_color: '#F5F6F8',
    });
    expect(read('index.html')).toContain('<link rel="manifest" href="./manifest.json" />');
  });

  it('gives every platform the Market Kasa icon', () => {
    const manifest = JSON.parse(read('public/manifest.json')) as {
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: './icon-192.png', sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ src: './icon-512.png', sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({
          src: './icon-maskable-512.png',
          sizes: '512x512',
          purpose: 'maskable',
        }),
      ]),
    );
    // iPhone takes its home screen icon from this link, not from the manifest.
    expect(read('index.html')).toContain(
      '<link rel="apple-touch-icon" href="./apple-touch-icon.png" />',
    );
    expect(read('site/index.html')).toContain(
      '<link rel="apple-touch-icon" href="img/apple-touch-icon.png" />',
    );
    expect(read('site/index.html')).toContain('src="img/logo.svg"');
    expect(read('public/logo.svg')).toBe(read('branding/mark.svg'));
    expect(read('site/img/logo.svg')).toBe(read('branding/mark.svg'));
    expect(read('android/app/src/main/res/values/ic_launcher_background.xml')).toContain('#2852E6');
  });
});
