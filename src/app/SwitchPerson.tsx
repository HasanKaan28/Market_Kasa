import { useLiveQuery } from 'dexie-react-hooks';
import { Users } from 'lucide-react';
import { useState, type JSX } from 'react';
import { listStaff } from '@/data/staff';
import { Button, Dialog } from '@/design';
import { ROLE_LABELS } from '@/domain/permissions';
import { useData } from './appData';
import { useSession } from './session';

/**
 * "Kişi değiştir", for a market that asks for no PIN: the active staff by name, and one tap makes
 * that person the one at the register, whose sales and actions are then theirs.
 */
export function SwitchPerson(): JSX.Element {
  const { db } = useData();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const people = useLiveQuery(() => (open ? listStaff(db, { active: true }) : []), [db, open]);

  return (
    <>
      <Button
        variant="ghost"
        icon={<Users aria-hidden="true" size={18} />}
        onClick={() => setOpen(true)}
      >
        Kişi değiştir
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Kişi değiştir"
        description="Kasada kim çalışıyor?"
      >
        <ul className="grid grid-cols-2 gap-2">
          {(people ?? []).map((person) => {
            const current = person.id === session.staff?.id;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    session.signIn(person);
                    setOpen(false);
                  }}
                  className={`flex min-h-16 w-full flex-col items-start justify-center rounded-control border px-4 py-2 text-left hover:bg-bg ${current ? 'border-accent' : 'border-line-strong'}`}
                >
                  <span className="font-semibold">{person.name}</span>
                  <span className="text-sm text-text-2">{ROLE_LABELS[person.role]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
