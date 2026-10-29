import { useEffect, useState, type JSX } from 'react';
import { clearStoredCarts } from '@/pos/held';
import { PosScreen } from '@/pos/PosScreen';
import { CustomersScreen } from '@/customers/CustomersScreen';
import { ProductsScreen } from '@/products/ProductsScreen';
import { StockScreen } from '@/stock/StockScreen';
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
    <ErrorBoundary {...(route === 'pos' ? { onReset: resetRegister } : LEAVE_SCREEN)}>
      <DataProvider value={data}>
        {route === 'products' ? (
          <ProductsScreen />
        ) : route === 'stock' ? (
          <StockScreen />
        ) : route === 'customers' ? (
          <CustomersScreen />
        ) : (
          <PosScreen />
        )}
      </DataProvider>
    </ErrorBoundary>
  );
}

/** The way out of a crash: a stored cart that cannot be shown is the usual cause. */
function resetRegister(): void {
  clearStoredCarts();
  window.location.reload();
}

// A crash on another screen has nothing to do with the carts: keep them and go back to the
// register, which a reload of the crashed screen would never reach.
const LEAVE_SCREEN = {
  message: 'Kaydedilen satışlar ve ürünler güvende. Kasaya dönüp devam edebilirsiniz.',
  resetLabel: 'Kasaya dön',
  onReset: () => {
    window.location.hash = '#/pos';
    window.location.reload();
  },
};
