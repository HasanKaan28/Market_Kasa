import path from 'node:path';
import { describe, expect, it } from 'vitest';
import security from './security.cjs';

const { CONTENT_SECURITY_POLICY, devToolsAllowed, isExternalUrl, resolveAppFile } = security;

const dist = path.resolve('/opt/market-kasa/dist');

describe('electron security', () => {
  it('opens only https links outside', () => {
    expect(isExternalUrl('https://wa.me/?text=merhaba')).toBe(true);
    expect(isExternalUrl('https://world.openfoodfacts.org/product/1')).toBe(true);
    expect(isExternalUrl('http://example.com/')).toBe(false);
    expect(isExternalUrl('file:///C:/Windows/system32/calc.exe')).toBe(false);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('app://market/index.html')).toBe(false);
    expect(isExternalUrl('not a url')).toBe(false);
  });

  it('keeps requests inside dist', () => {
    expect(resolveAppFile(dist, 'app://market/')).toBe(path.join(dist, 'index.html'));
    expect(resolveAppFile(dist, 'app://market/index.html')).toBe(path.join(dist, 'index.html'));
    expect(resolveAppFile(dist, 'app://market/assets/index-B0x9.js')).toBe(
      path.join(dist, 'assets', 'index-B0x9.js'),
    );
    expect(resolveAppFile(dist, 'app://market/assets/index-abc.js?v=1#x')).toBe(
      path.join(dist, 'assets', 'index-abc.js'),
    );
    expect(resolveAppFile(dist, 'app://market/assets/%C3%A7ay.svg')).toBe(
      path.join(dist, 'assets', 'çay.svg'),
    );
    // Dot segments are resolved by the URL itself, so they stay inside dist.
    expect(resolveAppFile(dist, 'app://market/../secret.txt')).toBe(path.join(dist, 'secret.txt'));
    expect(resolveAppFile(dist, 'app://market/%2e%2e/%2e%2e/secret.txt')).toBe(
      path.join(dist, 'secret.txt'),
    );
    // An escaped backslash, another host, another scheme, or a broken escape.
    expect(resolveAppFile(dist, 'app://market/assets/..%5C..%5Csecret.txt')).toBeNull();
    expect(resolveAppFile(dist, 'app://market/assets/%2F..%2F..%2Fsecret.txt')).toBeNull();
    expect(resolveAppFile(dist, 'app://other/index.html')).toBeNull();
    expect(resolveAppFile(dist, 'https://market/index.html')).toBeNull();
    expect(resolveAppFile(dist, 'app://market/%E0%A4%A')).toBeNull();
  });

  it('turns developer tools off when packaged', () => {
    expect(devToolsAllowed(true)).toBe(false);
    expect(devToolsAllowed(false)).toBe(true);
  });

  it('sends a policy that allows only what the app uses', () => {
    const directives = Object.fromEntries(
      CONTENT_SECURITY_POLICY.split(';').map((part: string) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'img-src': "'self' data: blob:",
      'font-src': "'self' data:",
      'media-src': "'self' blob: mediastream:",
      'connect-src': "'self' https://world.openfoodfacts.org",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'frame-ancestors': "'none'",
    });
  });
});
