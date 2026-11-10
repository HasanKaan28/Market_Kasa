import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createAppData, type AppData } from '@/app/appData';
import { DataProvider } from '@/app/DataProvider';
import { DEFAULT_DEVICE } from '@/app/device';

const created: AppData[] = [];

/** App data on a uniquely named market; `disposeTestData` deletes it after the test. */
export function createTestData(): AppData {
  const data = createAppData({ ...DEFAULT_DEVICE, marketId: `test-${crypto.randomUUID()}` });
  created.push(data);
  return data;
}

/** Renders inside a DataProvider; `rerender` keeps the provider. */
export async function renderWithData(
  ui: ReactElement,
  data: AppData = createTestData(),
): Promise<RenderResult & { data: AppData }> {
  const result = render(ui, {
    wrapper: ({ children }) => <DataProvider value={data}>{children}</DataProvider>,
  });
  return { ...result, data };
}

export async function disposeTestData(): Promise<void> {
  await Promise.all(created.splice(0).map((data) => data.db.delete()));
}
