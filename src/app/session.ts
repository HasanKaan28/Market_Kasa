import { createContext, useContext } from 'react';
import type { StaffRecord } from '@/data/types';
import type { Permission } from '@/domain/permissions';

/** Who works this register now, and what they may do. */
export type Session = {
  /** The person signed in; null while no staff are set up. */
  staff: StaffRecord | null;
  /** No staff are set up yet: the app runs as it did before, with every permission. */
  open: boolean;
  can(permission: Permission): boolean;
  signIn(staff: StaffRecord): void;
  signOut(): void;
};

export const SessionContext = createContext<Session | null>(null);

const OPEN_SESSION: Session = {
  staff: null,
  open: true,
  can: () => true,
  signIn: () => {},
  signOut: () => {},
};

/**
 * The session the app runs in. Outside a provider, as when a screen is tested on its own, it is
 * the open session of a market with no staff set up.
 */
export function useSession(): Session {
  return useContext(SessionContext) ?? OPEN_SESSION;
}

const STORAGE_KEY = 'mk2.staff';

/** The person signed in on this device, kept across a reload. */
export function loadSessionStaffId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSessionStaffId(staffId: string | null): void {
  try {
    if (staffId === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, staffId);
    }
  } catch {
    // Storage blocked: the session lasts until the page is closed.
  }
}
