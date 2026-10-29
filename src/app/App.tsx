import { useEffect, useState, type JSX } from 'react';
import { CART_STORAGE_KEY } from '@/pos/cart';
import { PosScreen } from '@/pos/PosScreen';
import { createAppData } from './appData';
import { DataProvider } from './DataProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { loadDeviceSettings } from './device';

export function App(): JSX.Element {
  const [data] = useState(() => createAppData(loadDeviceSettings()));

  useEffect(() => {
    void data.runner.run();
    data.runner.start();
    return () => data.runner.stop();
  }, [data]);

  return (
    <ErrorBoundary onReset={resetRegister}>
      <DataProvider value={data}>
        <PosScreen />
      </DataProvider>
    </ErrorBoundary>
  );
}

/** The way out of a crash: a stored cart that cannot be shown is the usual cause. */
function resetRegister(): void {
  try {
    localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    // Storage blocked: reloading is still the best we can do.
  }
  window.location.reload();
}
