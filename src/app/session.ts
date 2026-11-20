import { createContext, useContext } from 'react';
import type { StaffRecord } from '@/data/types';
import { can, type Permission } from '@/domain/permissions';

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

/** An owner's or a manager's PIN is asked again this long after it was typed. */
export const PRIVILEGED_SESSION_MS = 24 * 60 * 60_000;

/**
 * Whether a person's sign-in is kept to a day: an owner, a manager, or anyone who may change
 * staff, devices and settings. A cashier's stays until they lock the register.
 */
export function isPrivileged(staff: StaffRecord): boolean {
  return staff.role === 'owner' || staff.role === 'manager' || can(staff, 'admin');
}

/** Who signed in on this device, and when their PIN was typed. */
export type StoredSignIn = { staffId: string; signedInAt: string };

/**
 * The person signed in on this device, kept across a reload and a restart. A sign-in kept by an
 * earlier version holds only the id: it counts as made now, and is kept again with that time, so
 * an update never asks for a PIN by itself.
 */
export function loadSessionStaffId(now: Date = new Date()): StoredSignIn | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') {
    return null;
  }
  const kept = readSignIn(raw);
  if (kept) {
    return kept;
  }
  const upgraded = { staffId: raw, signedInAt: now.toISOString() };
  saveSessionStaffId(upgraded);
  return upgraded;
}

/** Keeps who signed in and when; null forgets them. */
export function saveSessionStaffId(signIn: StoredSignIn | null): void {
  try {
    if (signIn === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(signIn));
    }
  } catch {
    // Storage blocked: the session lasts until the page is closed.
  }
}

/** A kept sign-in in the current form, or null for anything else (an earlier version's bare id). */
function readSignIn(raw: string): StoredSignIn | null {
  if (!raw.startsWith('{')) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<StoredSignIn> | null;
    return typeof value?.staffId === 'string' &&
      typeof value.signedInAt === 'string' &&
      !Number.isNaN(Date.parse(value.signedInAt))
      ? { staffId: value.staffId, signedInAt: value.signedInAt }
      : null;
  } catch {
    return null;
  }
}
