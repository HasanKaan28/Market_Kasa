import type { JSX } from 'react';
import { Button, TextField } from '@/design';
import { AppShell } from './AppShell';

export function App(): JSX.Element {
  return (
    <AppShell
      marketName="Kurşunlu Market"
      deviceName="Kasa 1"
      staffName="Elif Y."
      syncState="online"
      activeNav="pos"
    >
      <TextField
        label="Barkod veya ürün adı"
        hint="Okuyucu ile okutun ya da yazmaya başlayın."
        type="search"
      />
      <div className="mt-auto flex flex-wrap gap-2">
        <Button kbd="F8" disabled>
          Beklet
        </Button>
        <Button kbd="F7" disabled>
          İade
        </Button>
        <Button kbd="F9" disabled>
          Son fişler
        </Button>
      </div>
    </AppShell>
  );
}
