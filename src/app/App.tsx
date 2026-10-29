import { useEffect, useState, type JSX } from 'react';
import { clearStoredCarts } from '@/pos/held';
import { PosScreen } from '@/pos/PosScreen';
import { ProductsScreen } from '@/products/ProductsScreen';
import { createAppData } from './appData';
import { DataProvider } from './DataProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { loadDeviceSettings } from './device';
import { useRoute } from './route';

export function App(): JSX.Element {
  const [data] = useState(() => createAppData(loadDeviceSettings()));
  const route = useRoute();

  useEffect(() => {
    void data.runner.run();
    data.runner.start();
    return () => data.runner.stop();
  }, [data]);

  return (
    <ErrorBoundary onReset={resetRegister}>
      <DataProvider value={data}>
        {route === 'products' ? <ProductsScreen /> : <PosScreen />}
      </DataProvider>
    </ErrorBoundary>
  );
}

/** The way out of a crash: a stored cart that cannot be shown is the usual cause. */
function resetRegister(): void {
  clearStoredCarts();
  window.location.reload();
}
