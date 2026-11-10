import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppData, useData, type AppData } from './appData';
import { DataProvider } from './DataProvider';
import { DEFAULT_DEVICE } from './device';

let data: AppData;
beforeEach(() => {
  data = createAppData({ ...DEFAULT_DEVICE, marketId: `test-${crypto.randomUUID()}` });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await data.db.delete();
});

describe('app data', () => {
  it('hands the app data to its children', () => {
    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => <DataProvider value={data}>{children}</DataProvider>,
    });
    expect(result.current).toBe(data);
  });

  it('refuses to work without a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useData())).toThrow('useData needs a DataProvider');
  });

  it('starts offline until a server is configured', async () =>
    expect((await data.runner.run()).state).toBe('offline'));
});
