import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { loadMarketSettings } from '@/data/settings';
import { listStaff } from '@/data/staff';
import type { StaffRecord } from '@/data/types';
import { can } from '@/domain/permissions';
import { useData } from './appData';
import { useMarketSettings } from './marketSettings';
import {
  isPrivileged,
  loadSessionStaffId,
  PRIVILEGED_SESSION_MS,
  saveSessionStaffId,
  SessionContext,
  type Session,
} from './session';
import { SignInScreen } from './SignInScreen';

const MINUTE_MS = 60_000;

/** Set once the market has had staff on this device: from then on it never opens with nobody at it. */
export const HAD_STAFF_KEY = 'hadStaff';

// What counts as someone at the register: a tap, a click, a key (a barcode scanner types too).
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Runs the app as the person signed in on this register. While staff are set up and nobody is
 * signed in, or the person signed in has been archived (here or on another device), it shows the
 * sign-in screen instead; with no staff ever set up it lets everyone in. A market that has had
 * staff never falls back to that: with nobody left to sign in it stays locked until the staff
 * come back with the sync. A sign-in lasts across a reload and a restart; an owner's or a
 * manager's asks for the PIN again a day after it was typed, and, if the market turns on
 * "Otomatik kilit", after that many minutes without input. A cashier's lasts until they lock the
 * register. `minuteMs` and `privilegedSessionMs` shorten those for tests. Until it knows who is
 * signed in, it shows nothing, so no screen flashes past the sign-in.
 *
 * All of that holds while the market asks for PINs ("PIN sor"). Off, which is the default, no PIN
 * is ever asked: the register opens as the person last at it while they are active, else as the
 * first active owner, and stays so with no day limit and no idle lock; the person is switched with
 * one tap. Only a market that has had staff and has none active left stays locked.
 */
export function SessionProvider({
  children,
  minuteMs = MINUTE_MS,
  privilegedSessionMs = PRIVILEGED_SESSION_MS,
}: {
  children: ReactNode;
  minuteMs?: number;
  privilegedSessionMs?: number;
}): JSX.Element | null {
  const { db } = useData();
  const { idleLockMinutes } = useMarketSettings();
  const idleLockMs = idleLockMinutes * minuteMs;
  const view = useLiveQuery(async () => {
    const [people, marker, settings] = await Promise.all([
      listStaff(db),
      db.meta.get(HAD_STAFF_KEY),
      loadMarketSettings(db),
    ]);
    return {
      people: people.filter((person) => !person.archivedAt),
      // Anyone ever set up, archived or not, counts: the marker only outlives them all.
      hadStaff: people.length > 0 || marker?.value === true,
      marked: marker?.value === true,
      requirePin: settings.requirePin,
    };
  }, [db]);
  const [stored, setStored] = useState(() => loadSessionStaffId());
  const [startedAt] = useState(() => Date.now());
  const people = view?.people;
  // The same function across renders: the sync rewriting the staff must not restart the idle lock.
  const signOut = useCallback(() => {
    saveSessionStaffId(null);
    setStored(null);
  }, []);
  const signIn = useCallback((person: StaffRecord) => {
    const signedIn = { staffId: person.id, signedInAt: new Date().toISOString() };
    saveSessionStaffId(signedIn);
    setStored(signedIn);
  }, []);

  const session = useMemo<Session | null>(() => {
    if (view === undefined) {
      return null;
    }
    const open = !view.hadStaff;
    const { requirePin } = view;
    const found = stored ? view.people.find((person) => person.id === stored.staffId) : undefined;
    // An owner's or a manager's PIN typed a day or more before the app started is asked again; a
    // day running out while it is open is seen to by the timer below.
    const expired =
      requirePin &&
      found !== undefined &&
      stored !== null &&
      isPrivileged(found) &&
      startedAt - Date.parse(stored.signedInAt) >= privilegedSessionMs;
    const staff = requirePin
      ? found && !expired
        ? found
        : null
      : (found ?? withoutPin(view.people));
    return {
      staff,
      open,
      requirePin,
      can: (permission) => open || (staff !== null && can(staff, permission)),
      signIn,
      signOut,
    };
  }, [view, stored, signIn, signOut, privilegedSessionMs, startedAt]);

  // Remembered on this device once there are staff, so losing them all does not open the app.
  const mark = view !== undefined && view.people.length > 0 && !view.marked;
  useEffect(() => {
    if (mark) {
      void db.meta.put({ key: HAD_STAFF_KEY, value: true });
    }
  }, [db, mark]);

  // A person no longer among the active staff, or an owner or a manager whose day is over, is
  // shown the sign-in at once (session.staff is null) and forgotten by this device, so a reload
  // does not bring them back.
  const gone = session !== null && !session.open && stored !== null && session.staff === null;
  useEffect(() => {
    if (gone) {
      saveSessionStaffId(null);
    }
  }, [gone]);

  // An owner's or a manager's day can run out with the app open: the PIN is asked then.
  // Without PINs neither the day nor the idle lock applies.
  const watched =
    session?.requirePin && session.staff && isPrivileged(session.staff) ? session.staff.id : null;
  const signedInAt = watched !== null ? stored?.signedInAt : undefined;
  useEffect(() => {
    if (signedInAt === undefined) {
      return;
    }
    const left = Date.parse(signedInAt) + privilegedSessionMs - Date.now();
    const timer = window.setTimeout(signOut, Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [signedInAt, signOut, privilegedSessionMs]);

  // If the market turns on "Otomatik kilit", an owner or a manager who walks away is signed out
  // after that many minutes with no input.
  useEffect(() => {
    if (watched === null || idleLockMs <= 0) {
      return;
    }
    let timer = window.setTimeout(signOut, idleLockMs);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(signOut, idleLockMs);
    };
    for (const type of ACTIVITY) {
      window.addEventListener(type, restart, { capture: true, passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const type of ACTIVITY) {
        window.removeEventListener(type, restart, { capture: true });
      }
    };
  }, [watched, signOut, idleLockMs]);

  if (session === null || people === undefined) {
    return null;
  }
  return (
    <SessionContext value={session}>
      {session.open || session.staff ? (
        children
      ) : people.length === 0 ? (
        <NobodyToSignIn />
      ) : (
        <SignInScreen people={people} onSignedIn={session.signIn} />
      )}
    </SessionContext>
  );
}

/**
 * Who the register opens as without PINs when the person last at it is gone: the first active
 * owner by name, else the first active person (owners archived or demoted on two registers
 * offline can leave none), else nobody.
 */
function withoutPin(people: readonly StaffRecord[]): StaffRecord | null {
  return people.find((person) => person.role === 'owner') ?? people[0] ?? null;
}

/** A market that has had staff, with nobody left here to sign in: it waits for the sync. */
function NobodyToSignIn(): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <section
        role="alert"
        className="flex w-full max-w-[420px] flex-col gap-3 rounded-control border border-line bg-surface p-6"
      >
        <h1 className="text-xl font-semibold">Kasa kilitli</h1>
        <p>Bu kasada giriş yapabilecek personel yok.</p>
        <p className="text-text-2">
          İnternet bağlantısını kontrol edin; personel kayıtları eşitlemeyle geri gelince giriş
          ekranı açılır. Sorun sürerse destek ile görüşün.
        </p>
      </section>
    </main>
  );
}
