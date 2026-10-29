import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { useSession } from '@/app/session';
import { listStaff } from '@/data/staff';
import { Button, ToastRegion, useToast } from '@/design';
import { ROLE_LABELS } from '@/domain/permissions';
import { MarketSection, ReceiptSection, RegisterSection } from './MarketSections';
import { StaffDialog } from './StaffDialog';

/** The owner's settings: the market, this register, the receipt and the people who work here. */
export function SettingsScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const toast = useToast();
  const people = useLiveQuery(() => listStaff(db), [db]);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'edit'; id: string } | null>(null);
  const editing =
    dialog?.kind === 'edit' ? people?.find((person) => person.id === dialog.id) : null;

  function done(message: string) {
    setDialog(null);
    toast.show(message);
    void runner.run();
  }

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        activeNav="settings"
      >
        <h1 className="text-xl font-semibold">Ayarlar</h1>
        <MarketSection onDone={(message) => done(message)} />
        <RegisterSection />
        <ReceiptSection onDone={(message) => done(message)} />
        <section
          aria-labelledby="staff-heading"
          className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h2 id="staff-heading" className="text-lg font-semibold">
                Personel
              </h2>
              <p className="text-sm text-text-2">
                Her kişi kasaya kendi PIN'iyle girer; izinler rolden gelir, kişiye göre
                değiştirilebilir.
              </p>
            </div>
            <Button
              variant="primary"
              icon={<Plus aria-hidden="true" size={18} />}
              onClick={() => setDialog({ kind: 'new' })}
            >
              Yeni personel
            </Button>
          </div>
          {people === undefined ? null : people.length === 0 ? (
            <p className="text-text-2">
              Henüz personel yok. İlk eklenen kişi sahip olur; ondan sonra kasa PIN ile açılır.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'edit', id: person.id })}
                    className="flex min-h-14 w-full items-center gap-3 px-1 text-left hover:bg-bg"
                  >
                    <span className="font-medium">{person.name}</span>
                    <span className="text-sm text-text-2">{ROLE_LABELS[person.role]}</span>
                    {person.archivedAt ? (
                      <span className="ml-auto rounded-chip bg-bg px-2 py-0.5 text-sm text-muted">
                        Pasif
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </AppShell>
      {dialog?.kind === 'new' && people !== undefined ? (
        <StaffDialog
          open
          first={!people.some((person) => person.role === 'owner' && !person.archivedAt)}
          onClose={() => setDialog(null)}
          onDone={(message, created) => {
            // The first person is the owner who set things up: they stay signed in.
            if (created && session.open) {
              session.signIn(created);
            }
            done(message);
          }}
        />
      ) : null}
      {editing ? (
        <StaffDialog
          open
          person={editing}
          onClose={() => setDialog(null)}
          onDone={(message) => done(message)}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}
