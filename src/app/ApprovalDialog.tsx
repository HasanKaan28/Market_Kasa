import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type FormEvent, type JSX } from 'react';
import { checkPin, listStaff } from '@/data/staff';
import type { StaffRecord } from '@/data/types';
import { Button, Dialog, SelectField, TextField } from '@/design';
import { can, PERMISSION_LABELS, ROLE_LABELS, type Permission } from '@/domain/permissions';
import { isValidPin } from '@/domain/pin';
import { formatTime } from '@/pos/format';
import { useData } from './appData';

export type ApprovalDialogProps = {
  open: boolean;
  permission: Permission;
  /** What is being approved, shown to the approver: the amount and whose it is. */
  summary?: string;
  /** May wait on writing the approval down; if that fails, the dialog says so and stays. */
  onApproved(approver: StaffRecord): void | Promise<void>;
  onClose(): void;
};

/**
 * Lets a person allowed to do something approve it for someone who is not: they pick themselves
 * and type their own PIN, which counts towards their own lock like a sign-in.
 */
export function ApprovalDialog({
  open,
  permission,
  summary,
  onApproved,
  onClose,
}: ApprovalDialogProps): JSX.Element {
  const { db } = useData();
  const people = useLiveQuery(() => listStaff(db, { active: true }), [db]);
  const approvers = (people ?? []).filter((person) => can(person, permission));
  const [chosenId, setChosenId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  // Set from the moment the PIN is checked until the approval is written down: closing then would
  // leave the action half approved, so the dialog stays until it is done.
  const busy = useRef(false);
  const chosen = approvers.find((person) => person.id === chosenId) ?? approvers[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || busy.current) {
      return;
    }
    if (!isValidPin(pin)) {
      setError('PIN 4–6 rakamdır.');
      return;
    }
    busy.current = true;
    setChecking(true);
    try {
      const result = await checkPin(db, chosen.id, pin, new Date());
      if (result.ok && can(result.staff, permission)) {
        try {
          await onApproved(result.staff);
        } catch {
          setError('Onay kaydedilemedi. Yeniden deneyin.');
        }
        return;
      }
      setPin('');
      setError(
        result.ok
          ? 'Bu kişinin bu işlem için yetkisi yok.'
          : result.reason === 'wrong'
            ? `PIN yanlış. ${result.attemptsLeft} deneme kaldı.`
            : result.reason === 'locked'
              ? `Çok fazla hatalı deneme. Kilidin bitişi: ${formatTime(result.until)}.`
              : 'Bu kişi artık onay veremez.',
      );
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy.current && onClose()}
      title="Yetkili onayı"
      description={`"${PERMISSION_LABELS[permission]}" için yetkili birinin onayı gerekir.`}
    >
      {summary ? (
        <p className="rounded-control border border-line-strong bg-bg px-3 py-2 text-[17px] font-semibold">
          {summary}
        </p>
      ) : null}
      {people === undefined ? (
        <p className="text-text-2">Yükleniyor…</p>
      ) : approvers.length === 0 ? (
        // Owners demoted on two registers offline can leave nobody once they sync.
        <p role="alert" className="font-medium text-danger">
          Bu işlemi onaylayabilecek kimse yok.
        </p>
      ) : (
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <SelectField
            label="Onaylayan"
            options={approvers.map((person) => ({
              value: person.id,
              label: `${person.name} · ${ROLE_LABELS[person.role]}`,
            }))}
            value={chosen?.id ?? ''}
            onChange={(event) => {
              setChosenId(event.target.value);
              setError(undefined);
            }}
          />
          <TextField
            label="PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={6}
            value={pin}
            error={error}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          />
          <Button type="submit" variant="primary" size="lg" disabled={checking || !chosen}>
            Onayla
          </Button>
        </form>
      )}
    </Dialog>
  );
}
