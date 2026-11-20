import { useRef, useState, type JSX } from 'react';
import { recordApproval, type ApprovalTarget } from '@/data/audit';
import type { Permission } from '@/domain/permissions';
import { useActor } from './actor';
import { ApprovalDialog } from './ApprovalDialog';
import { useData } from './appData';
import { useSession } from './session';

type Pending = { permission: Permission; target?: ApprovalTarget; done(approved: boolean): void };

/**
 * Lets a screen ask, as the register does, for a permitted person's PIN before an action the
 * person signed in may not do. Ask once the amount is known, so the approver sees it in the
 * `summary` and the log keeps it beside the record. The approval is logged before the action
 * goes ahead; render `dialog` beside the screen.
 *
 * While the market asks for no PIN, nothing waits: the action goes ahead as the person at the
 * register, logged as their own approval marked `pinless`. A permission they lack then only hides
 * screens.
 */
export function useApproval(): {
  /** Runs `next` at once when allowed, else after an approval; nothing when it is turned down. */
  ask(permission: Permission, next: () => void, target?: ApprovalTarget): void;
  /** True when allowed or approved, false when the approval dialog is closed without one. */
  confirm(permission: Permission, target?: ApprovalTarget): Promise<boolean>;
  dialog: JSX.Element | null;
} {
  const { db } = useData();
  const session = useSession();
  const actor = useActor();
  const [pending, setPending] = useState<Pending | null>(null);
  // The approval waiting now. Each is answered once: a later ask turns the earlier one down, so
  // nothing waits on it for ever, and a closed dialog never lets its action run.
  const current = useRef<Pending | null>(null);

  function open(next: Pending) {
    current.current?.done(false);
    current.current = next;
    setPending(next);
  }

  function finish(which: Pending, approved: boolean) {
    if (current.current !== which) {
      return;
    }
    current.current = null;
    setPending(null);
    which.done(approved);
  }

  /**
   * Logs an action the person at the register may not do as done by them without a PIN. False
   * when it cannot be written down: the action then does not go ahead, as with a PIN.
   */
  async function goAheadWithoutPin(
    permission: Permission,
    target: ApprovalTarget | undefined,
  ): Promise<boolean> {
    const approverId = session.staff?.id;
    if (approverId === undefined) {
      return false;
    }
    try {
      await recordApproval(
        db,
        { permission, approverId, ...target, pinless: true },
        new Date(),
        actor,
      );
      return true;
    } catch {
      return false;
    }
  }

  function ask(permission: Permission, next: () => void, target?: ApprovalTarget) {
    if (session.can(permission)) {
      next();
    } else if (!session.requirePin) {
      void goAheadWithoutPin(permission, target).then((approved) => approved && next());
    } else {
      open({ permission, target, done: (approved) => approved && next() });
    }
  }

  function confirm(permission: Permission, target?: ApprovalTarget): Promise<boolean> {
    if (session.can(permission)) {
      return Promise.resolve(true);
    }
    if (!session.requirePin) {
      return goAheadWithoutPin(permission, target);
    }
    return new Promise((resolve) => open({ permission, target, done: resolve }));
  }

  const dialog = pending ? (
    <ApprovalDialog
      open
      permission={pending.permission}
      summary={pending.target?.summary}
      onClose={() => finish(pending, false)}
      onApproved={async (approver) => {
        await recordApproval(
          db,
          { permission: pending.permission, approverId: approver.id, ...pending.target },
          new Date(),
          actor,
        );
        finish(pending, true);
      }}
    />
  ) : null;

  return { ask, confirm, dialog };
}
