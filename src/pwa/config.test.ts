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
});
