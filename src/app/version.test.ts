import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { APP_VERSION } from './version';

describe('APP_VERSION', () => {
  it('comes from package.json only', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toBe('2.0.0-alpha.0');
  });
});
