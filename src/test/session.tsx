import type { ReactElement } from 'react';
import { SessionContext, type Session } from '@/app/session';
import type { StaffRecord } from '@/data/types';
import type { Permission } from '@/domain/permissions';

/**
 * Renders `ui` as a person who may do only what is listed, without setting up staff: for a screen
 * tested on its own, where what matters is what it shows to whom. The market asks for PINs unless
 * `requirePin` is false, so what the person may not do waits on an approval.
 */
export function asPersonWho(
  allowed: readonly Permission[],
  ui: ReactElement,
  { requirePin = true }: { requirePin?: boolean } = {},
): ReactElement {
  const staff: StaffRecord = {
    id: 'staff-test',
    name: 'Deneme',
    role: 'cashier',
    pinHash: '',
    pinSalt: '',
    pinIterations: 150_000,
    createdAt: '',
    updatedAt: '',
  };
  const session: Session = {
    staff,
    open: false,
    requirePin,
    can: (permission) => allowed.includes(permission),
    signIn: () => {},
    signOut: () => {},
  };
  return <SessionContext value={session}>{ui}</SessionContext>;
}
