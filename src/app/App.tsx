import { useEffect, useState, type JSX } from 'react';
import { PosScreen } from '@/pos/PosScreen';
import { createAppData } from './appData';
import { DataProvider } from './DataProvider';
import { loadDeviceSettings } from './device';

export function App(): JSX.Element {
  const [data] = useState(() => createAppData(loadDeviceSettings()));

  useEffect(() => {
    void data.runner.run();
    data.runner.start();
    return () => data.runner.stop();
  }, [data]);

  return (
    <DataProvider value={data}>
      <PosScreen />
    </DataProvider>
  );
}
