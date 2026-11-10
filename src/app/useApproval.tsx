import { useState, type JSX } from 'react';
import { recordApproval } from '@/data/audit';
import type { Permission } from '@/domain/permissions';
import { useActor } from './actor';
import { ApprovalDialog } from './ApprovalDialog';
import { useData } from './appData';
import { useSession } from './session';

/**
 * Lets a screen ask, as the register does, for a permitted person's PIN before an action the
 * person signed in may not do. The approval is logged; render `dialog` beside the screen.
 */
export function useApproval(): {
  ask(permission: Permission, next: () => void): void;
  dialog: JSX.Element | null;
} {
  const { db } = useData();
  const session = useSession();
  const actor = useActor();
  const [pending, setPending] = useState<{ permission: Permission; next: () => void } | null>(null);

  function ask(permission: Permission, next: () => void) {
    if (session.can(permission)) {
      next();
    } else {
      setPending({ permission, next });
    }
  }

  const dialog = pending ? (
    <ApprovalDialog
      open
      permission={pending.permission}
      onClose={() => setPending(null)}
      onApproved={(approver) => {
        void recordApproval(
          db,
          { permission: pending.permission, approverId: approver.id },
          new Date(),
          actor,
        );
        setPending(null);
        pending.next();
      }}
    />
  ) : null;

  return { ask, dialog };
}
