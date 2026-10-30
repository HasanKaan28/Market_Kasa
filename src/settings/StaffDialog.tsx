import { useState, type FormEvent, type JSX } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { LastOwnerError } from '@/data/errors';
import { archiveStaff, createStaff, restoreStaff, setStaffPin, updateStaff } from '@/data/staff';
import type { StaffRecord } from '@/data/types';
import { Button, Dialog, SelectField, TextField } from '@/design';
import {
  can,
  PERMISSION_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from '@/domain/permissions';
import { isValidPin } from '@/domain/pin';

export type StaffDialogProps = {
  open: boolean;
  /** The person to change; absent to add one. */
  person?: StaffRecord;
  /** No active owner yet: the person added is the owner. */
  first?: boolean;
  onClose(): void;
  onDone(message: string, created?: StaffRecord): void;
};

type Overrides = Partial<Record<Permission, boolean>>;

const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

/** Adds a person, or changes one: name, role, own permissions, PIN, and whether they still work here. */
export function StaffDialog({
  open,
  person,
  first = false,
  onClose,
  onDone,
}: StaffDialogProps): JSX.Element {
  const { db } = useData();
  const actor = useActor();
  const [name, setName] = useState(person?.name ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? (first ? 'owner' : 'cashier'));
  const [overrides, setOverrides] = useState<Overrides>(person?.permissions ?? {});
  const [pin, setPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [changingPin, setChangingPin] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; pin?: string; pinAgain?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function run(save: () => Promise<void>) {
    if (saving) {
      return;
    }
    setSaving(true);
    setFailure(undefined);
    try {
      await save();
    } catch (error) {
      setFailure(
        error instanceof LastOwnerError
          ? 'Son sahip kalmalı: rolü değiştirilemez, pasife alınamaz.'
          : 'Kaydedilemedi.',
      );
    } finally {
      setSaving(false);
    }
  }

  function pinProblems(): boolean {
    const found: typeof errors = {};
    if (!isValidPin(pin)) {
      found.pin = 'PIN 4–6 rakamdır.';
    } else if (pin !== pinAgain) {
      found.pinAgain = 'PIN’ler aynı değil.';
    }
    if (!person && name.trim() === '') {
      found.name = 'Ad gerekli.';
    }
    setErrors(found);
    return Object.keys(found).length > 0;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) {
      if (pinProblems()) {
        return;
      }
      void run(async () => {
        const created = await createStaff(
          db,
          { name, role, pin, permissions: overridesFor(role, overrides) },
          new Date(),
          actor,
        );
        onDone(`${created.name} eklendi.`, created);
      });
      return;
    }
    if (name.trim() === '') {
      setErrors({ name: 'Ad gerekli.' });
      return;
    }
    void run(async () => {
      await updateStaff(
        db,
        person.id,
        { name, role, permissions: overridesFor(role, overrides) },
        new Date(),
        actor,
      );
      onDone(`${name.trim()} kaydedildi.`);
    });
  }

  function savePin() {
    if (!person || pinProblems()) {
      return;
    }
    void run(async () => {
      await setStaffPin(db, person.id, pin, new Date(), actor);
      onDone(`PIN değiştirildi · ${person.name}`);
    });
  }

  function toggleArchive() {
    if (!person) {
      return;
    }
    void run(async () => {
      if (person.archivedAt) {
        await restoreStaff(db, person.id, new Date(), actor);
        onDone(`${person.name} geri alındı.`);
      } else {
        await archiveStaff(db, person.id, new Date(), actor);
        onDone(`${person.name} pasife alındı.`);
      }
    });
  }

  const draft = { role, permissions: overrides };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={person ? person.name : 'Yeni personel'}
      size="lg"
    >
      {person && changingPin ? (
        // A form of its own, so Enter in a PIN field saves the PIN and nothing else.
        <form
          noValidate
          aria-label="PIN değiştir"
          className="flex flex-col gap-3 rounded-control border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            savePin();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <PinFields
              label="Yeni PIN"
              pin={pin}
              pinAgain={pinAgain}
              errors={errors}
              onPin={setPin}
              onPinAgain={setPinAgain}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              PIN’i kaydet
            </Button>
            <Button variant="ghost" onClick={() => setChangingPin(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Ad"
            autoComplete="off"
            autoFocus={!person}
            value={name}
            error={errors.name}
            onChange={(event) => setName(event.target.value)}
          />
          <SelectField
            label="Rol"
            options={ROLE_OPTIONS}
            value={role}
            disabled={first && !person}
            hint={first && !person ? 'İlk kişi sahiptir.' : undefined}
            onChange={(event) => setRole(event.target.value as Role)}
          />
        </div>
        {!person ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <PinFields
              label="PIN"
              pin={pin}
              pinAgain={pinAgain}
              errors={errors}
              onPin={setPin}
              onPinAgain={setPinAgain}
            />
          </div>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">İzinler</legend>
          {role === 'owner' ? (
            <p className="text-sm text-text-2">Sahip her şeyi yapabilir.</p>
          ) : null}
          <div className="grid gap-x-4 sm:grid-cols-2">
            {/* Staff, devices, settings and exports are the owners' alone, never a person's own. */}
            {PERMISSIONS.filter((permission) => permission !== 'admin' || role === 'owner').map(
              (permission) => {
                const changed =
                  overrides[permission] !== undefined &&
                  overrides[permission] !== ROLE_PERMISSIONS[role].includes(permission);
                return (
                  <label
                    key={permission}
                    className="flex min-h-11 cursor-pointer items-center gap-3 has-disabled:cursor-default has-disabled:text-muted"
                  >
                    <input
                      type="checkbox"
                      className="size-5 accent-accent"
                      disabled={role === 'owner'}
                      checked={can(draft, permission)}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [permission]: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      {PERMISSION_LABELS[permission]}
                      {changed && role !== 'owner' ? (
                        <span className="ml-2 text-sm text-accent">kişiye özel</span>
                      ) : null}
                    </span>
                  </label>
                );
              },
            )}
          </div>
        </fieldset>
        {failure ? (
          <p role="alert" className="font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {person && !changingPin ? (
            <Button onClick={() => setChangingPin(true)}>PIN’i değiştir</Button>
          ) : null}
          {person ? (
            <Button variant={person.archivedAt ? 'secondary' : 'danger'} onClick={toggleArchive}>
              {person.archivedAt ? 'Geri al' : 'Pasife al'}
            </Button>
          ) : null}
          <Button type="submit" variant="primary" className="ml-auto" disabled={saving}>
            Kaydet
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A PIN typed twice, digits only. */
function PinFields({
  label,
  pin,
  pinAgain,
  errors,
  onPin,
  onPinAgain,
}: {
  label: string;
  pin: string;
  pinAgain: string;
  errors: { pin?: string; pinAgain?: string };
  onPin(pin: string): void;
  onPinAgain(pin: string): void;
}): JSX.Element {
  return (
    <>
      <TextField
        label={label}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={pin}
        error={errors.pin}
        onChange={(event) => onPin(event.target.value.replace(/\D/g, ''))}
      />
      <TextField
        label="PIN tekrar"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={pinAgain}
        error={errors.pinAgain}
        onChange={(event) => onPinAgain(event.target.value.replace(/\D/g, ''))}
      />
    </>
  );
}

/** Only what differs from the role's defaults is kept as the person's own. */
function overridesFor(role: Role, overrides: Overrides): Overrides | undefined {
  if (role === 'owner') {
    return undefined;
  }
  const kept = Object.fromEntries(
    PERMISSIONS.filter(
      (permission) =>
        overrides[permission] !== undefined &&
        overrides[permission] !== ROLE_PERMISSIONS[role].includes(permission),
    ).map((permission) => [permission, overrides[permission]]),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}
