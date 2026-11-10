import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, shouldRegister } from './register';

const web = { prod: true, native: false, protocol: 'https:', hostname: 'kasa.example.com' };

describe('service worker registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the worker only where it can run', async () => {
    expect(shouldRegister(web)).toBe(true);
    expect(shouldRegister({ ...web, protocol: 'http:', hostname: 'localhost' })).toBe(true);
    // Development, the Android app, the desktop app's own scheme, plain http elsewhere.
    expect(shouldRegister({ ...web, prod: false })).toBe(false);
    expect(shouldRegister({ ...web, native: true })).toBe(false);
    expect(shouldRegister({ ...web, protocol: 'app:', hostname: 'market' })).toBe(false);
    expect(shouldRegister({ ...web, protocol: 'file:', hostname: '' })).toBe(false);
    expect(shouldRegister({ ...web, protocol: 'http:', hostname: '192.168.1.20' })).toBe(false);

    const register = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    await registerServiceWorker(web, '2.0.0');
    expect(register).toHaveBeenCalledWith('./sw.js?v=2.0.0', { scope: './' });
    register.mockClear();
    await registerServiceWorker({ ...web, prod: false }, '2.0.0');
    expect(register).not.toHaveBeenCalled();
  });

  it('keeps going when the browser refuses the worker', async () => {
    const register = vi.fn(() => Promise.reject(new Error('blocked')));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    await expect(registerServiceWorker(web, '2.0.0')).resolves.toBeUndefined();
    vi.stubGlobal('navigator', {});
    await expect(registerServiceWorker(web, '2.0.0')).resolves.toBeUndefined();
  });
});
