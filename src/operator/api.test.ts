import { describe, expect, it, vi } from 'vitest';

const createClient = vi.fn((...args: unknown[]) => ({ args }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const { operatorClient, OPERATOR_STORAGE_KEY } = await import('./api');

describe('operatorClient', () => {
  it('keeps its session under its own key, apart from the register’s and the owner’s', () => {
    operatorClient({ url: 'https://x.supabase.co', key: 'sb_publishable_x' });
    const options = createClient.mock.calls[0]?.[2] as { auth: { storageKey: string } };
    expect(options.auth.storageKey).toBe(OPERATOR_STORAGE_KEY);
    expect(OPERATOR_STORAGE_KEY).not.toBe('mk2.auth');
    expect(OPERATOR_STORAGE_KEY).not.toBe('mk2.owner');
  });
});
