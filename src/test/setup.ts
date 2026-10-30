import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { disposeTestData } from './renderWithData';

// Vitest globals are off, so Testing Library cannot register its own cleanup. Unmount first, so
// no live query is still reading a database while it is deleted.
afterEach(async () => {
  cleanup();
  await disposeTestData();
  localStorage.clear();
});
