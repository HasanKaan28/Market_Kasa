import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { listStaff } from '@/data/staff';
import { can } from '@/domain/permissions';
import { useData } from './appData';
import { loadSessionStaffId, saveSessionStaffId, SessionContext, type Session } from './session';
import { SignInScreen } from './SignInScreen';

/**
 * Runs the app as the person signed in on this register. While staff are set up and nobody is
 * signed in, or the person signed in has been archived (here or on another device), it shows the
 * sign-in screen instead; with no staff set up it lets everyone in. Until it knows which, it shows
 * nothing, so no screen flashes past the sign-in.
 */
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element | null {
  const { db } = useData();
  const people = useLiveQuery(() => listStaff(db, { active: true }), [db]);
  const [staffId, setStaffId] = useState(() => loadSessionStaffId());

  const session = useMemo<Session | null>(() => {
    if (people === undefined) {
      return null;
    }
    const open = people.length === 0;
    const staff = open ? null : (people.find((person) => person.id === staffId) ?? null);
    return {
      staff,
      open,
      can: (permission) => open || (staff !== null && can(staff, permission)),
      signIn: (person) => {
        saveSessionStaffId(person.id);
        setStaffId(person.id);
      },
      signOut: () => {
        saveSessionStaffId(null);
        setStaffId(null);
      },
    };
  }, [people, staffId]);

  // A person no longer among the active staff is shown the sign-in at once (session.staff is
  // null) and forgotten by this device, so a reload does not bring them back.
  const gone = session !== null && !session.open && staffId !== null && session.staff === null;
  useEffect(() => {
    if (gone) {
      saveSessionStaffId(null);
    }
  }, [gone]);

  if (session === null || people === undefined) {
    return null;
  }
  return (
    <SessionContext value={session}>
      {session.open || session.staff ? (
        children
      ) : (
        <SignInScreen people={people} onSignedIn={session.signIn} />
      )}
    </SessionContext>
  );
}
