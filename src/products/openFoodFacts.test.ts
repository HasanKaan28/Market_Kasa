import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestProductName } from './openFoodFacts';

function answer(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('suggestProductName', () => {
  it('builds a name from the Turkish name, brand and quantity', async () => {
    const found = answer(200, {
      status: 1,
      product: {
        product_name_tr: 'Çikolatalı Gofret',
        product_name: 'Chocolate Wafer',
        brands: 'Ülker,Ülker Bisküvi',
        quantity: '36 g',
      },
    });
    expect(await suggestProductName('8690504000014', { fetch: found })).toEqual({
      name: 'Ülker Çikolatalı Gofret 36 g',
    });
    const english = answer(200, {
      status: 1,
      product: { product_name: 'Ülker Wafer', brands: 'Ülker' },
    });
    expect(await suggestProductName('8690504000014', { fetch: english })).toEqual({
      name: 'Ülker Wafer',
    });
  });

  it('says when the product is unknown, the device is offline or the answer is late', async () => {
    expect(
      await suggestProductName('8690000000000', { fetch: answer(404, { status: 0 }) }),
    ).toEqual({
      error: 'not-found',
    });
    expect(
      await suggestProductName('8690000000000', { fetch: answer(200, { status: 1, product: {} }) }),
    ).toEqual({
      error: 'not-found',
    });
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await suggestProductName('8690000000000', { fetch: offline })).toEqual({
      error: 'offline',
    });

    vi.useFakeTimers();
    const slow = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('late', 'AbortError')),
          );
        }),
    );
    const late = suggestProductName('8690000000000', { fetch: slow });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await late).toEqual({ error: 'timeout' });
  });
});
