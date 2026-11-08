import { useEffect, useState, type JSX } from 'react';
import { clearStoredCarts } from '@/pos/held';
import { createAppData } from './appData';
import { DataProvider } from './DataProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { loadDeviceSettings, saveDeviceSettings } from './device';
import { Screens } from './Screens';
import { SessionProvider } from './SessionProvider';
import { useRoute } from './route';
import { deviceClient, ownerClient } from '@/server/client';
import { SERVER } from '@/server/config';
import { joinMarket, openMarket } from '@/server/onboarding';
import { currentPlatform } from '@/server/pairing';
import { WELCOME_SKIPPED, shouldWelcome } from './welcome';
import { WelcomeScreen } from './WelcomeScreen';

export function App(): JSX.Element {
  const [data] = useState(() => createAppData(loadDeviceSettings()));
  const [welcome, setWelcome] = useState(() =>
    shouldWelcome(data.settings, SERVER, window.localStorage),
  );
  const route = useRoute();

  useEffect(() => {
    void data.runner.run();
    data.runner.start();
    return () => data.runner.stop();
  }, [data]);

  const server = SERVER;
  if (welcome && server) {
    const platform = currentPlatform();
    return (
      <WelcomeScreen
        current={data.settings}
        open={(input) =>
          openMarket({
            owner: ownerClient(server),
            device: deviceClient(server),
            platform,
            ...input,
          })
        }
        join={(input) =>
          joinMarket({
            owner: ownerClient(server),
            device: deviceClient(server),
            platform,
            ...input,
          })
        }
        onDone={(next) => {
          if (saveDeviceSettings(next)) {
            window.location.reload();
          }
        }}
        onSkip={() => {
          try {
            window.localStorage.setItem(WELCOME_SKIPPED, '1');
          } catch {
            // Without storage the screen returns on the next start; the shop can skip again.
          }
          setWelcome(false);
        }}
      />
    );
  }

  return (
    <ErrorBoundary {...(route === 'pos' ? { onReset: resetRegister } : LEAVE_SCREEN)}>
      <DataProvider value={data}>
        <SessionProvider>
          <Screens route={route} />
        </SessionProvider>
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
