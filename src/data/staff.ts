import { PERMISSIONS, ROLES, type Permission, type Role } from '@/domain/permissions';
import { hashPin, isValidPin, verifyPin } from '@/domain/pin';
import { addAudit, auditChange, type Actor } from './audit';
import type { MarketDb } from './db';
import { LastOwnerError, RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { changedFields, toPatch, withoutUndefined } from './records';
import type { StaffRecord } from './types';

export type NewStaff = {
  name: string;
  role: Role;
  pin: string;
  permissions?: Partial<Record<Permission, boolean>>;
};

export type StaffPatch = Partial<Pick<NewStaff, 'name' | 'role' | 'permissions'>>;

/** What a PIN typed for a person comes to. */
export type PinCheck =
  | { ok: true; staff: StaffRecord }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; until: string }
  | { ok: false; reason: 'inactive' };

// DESIGN §8.3: five wrong PINs lock the person for five minutes.
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;
const MAX_NAME_LENGTH = 60;
const byName = new Intl.Collator('tr');

const lockKey = (staffId: string) => `pinLock:${staffId}`;

/**
 * Adds a person with their PIN, kept only as a hash. While the market has no active owner, the
 * person added must be one: the first person set up is the owner.
 */
export async function createStaff(
  db: MarketDb,
  input: NewStaff,
  at: Date,
  actor?: Actor,
): Promise<StaffRecord> {
  const name = requireName(input.name);
  assertRole(input.role);
  const permissions = cleanPermissions(input.permissions);
  // Hashed before the transaction: IndexedDB commits a transaction left waiting on other work.
  const pin = await hashPin(requirePin(input.pin));
  const stamp = at.toISOString();
  const record: StaffRecord = withoutUndefined({
    id: newId(at.getTime()),
    name,
    role: input.role,
    permissions,
    pinHash: pin.hash,
    pinSalt: pin.salt,
    pinIterations: pin.iterations,
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.transaction('rw', db.staff, db.outbox, db.auditLog, async () => {
    if (record.role !== 'owner' && (await activeOwners(db)).length === 0) {
      throw new RangeError('The first person set up is the owner');
    }
    await db.staff.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'staff', recordId: record.id, record }, at);
    if (actor) {
      const after = withoutUndefined({
        name: record.name,
        role: record.role,
        permissions: record.permissions,
      });
      await addAudit(
        db,
        { action: 'staff.create', entity: 'staff', entityId: record.id, after },
        actor,
        at,
      );
    }
  });
  return record;
}

/** Changes a person's name, role or own permissions; the last active owner stays an owner. */
export async function updateStaff(
  db: MarketDb,
  id: string,
  patch: StaffPatch,
  at: Date,
  actor?: Actor,
): Promise<StaffRecord> {
  const changes: StaffPatch = {};
  if (patch.name !== undefined) {
    changes.name = requireName(patch.name);
  }
  if (patch.role !== undefined) {
    assertRole(patch.role);
    changes.role = patch.role;
  }
  if ('permissions' in patch) {
    const permissions = cleanPermissions(patch.permissions);
    changes.permissions = permissions;
  }
  return db.transaction('rw', db.staff, db.outbox, db.auditLog, async () => {
    const current = await requireStaff(db, id);
    if (changes.role !== undefined && changes.role !== 'owner') {
      await assertNotLastOwner(db, current);
    }
    const change = auditChange(current, changes, ['name', 'role', 'permissions']);
    const updated = await save(db, current, changes, at);
    if (actor && change) {
      await addAudit(
        db,
        { action: 'staff.update', entity: 'staff', entityId: id, ...change },
        actor,
        at,
      );
    }
    return updated;
  });
}

/** Gives a person a new PIN, which also lifts a lock from wrong PINs. */
export async function setStaffPin(
  db: MarketDb,
  id: string,
  pin: string,
  at: Date,
  actor?: Actor,
): Promise<StaffRecord> {
  const hashed = await hashPin(requirePin(pin));
  return db.transaction('rw', db.staff, db.outbox, db.meta, db.auditLog, async () => {
    const current = await requireStaff(db, id);
    await db.meta.delete(lockKey(id));
    const updated = await save(
      db,
      current,
      { pinHash: hashed.hash, pinSalt: hashed.salt, pinIterations: hashed.iterations },
      at,
    );
    if (actor) {
      await addAudit(db, { action: 'staff.pin', entity: 'staff', entityId: id }, actor, at);
    }
    return updated;
  });
}

/** Archives a person who no longer works here; the last active owner stays. */
export async function archiveStaff(
  db: MarketDb,
  id: string,
  at: Date,
  actor?: Actor,
): Promise<StaffRecord> {
  return db.transaction('rw', db.staff, db.outbox, db.auditLog, async () => {
    const current = await requireStaff(db, id);
    if (current.archivedAt) {
      return current;
    }
    await assertNotLastOwner(db, current);
    const updated = await save(db, current, { archivedAt: at.toISOString() }, at);
    if (actor) {
      await addAudit(db, { action: 'staff.archive', entity: 'staff', entityId: id }, actor, at);
    }
    return updated;
  });
}

/** Takes a person back. */
export async function restoreStaff(
  db: MarketDb,
  id: string,
  at: Date,
  actor?: Actor,
): Promise<StaffRecord> {
  return db.transaction('rw', db.staff, db.outbox, db.auditLog, async () => {
    const current = await requireStaff(db, id);
    if (!current.archivedAt) {
      return current;
    }
    const updated = await save(db, current, { archivedAt: undefined }, at);
    if (actor) {
      await addAudit(db, { action: 'staff.restore', entity: 'staff', entityId: id }, actor, at);
    }
    return updated;
  });
}

/** Everyone, or only those who can sign in, by name. */
export async function listStaff(
  db: MarketDb,
  { active = false }: { active?: boolean } = {},
): Promise<StaffRecord[]> {
  const people = await db.staff.toArray();
  return people
    .filter((person) => !active || !person.archivedAt)
    .sort((a, b) => byName.compare(a.name, b.name));
}

/**
 * Checks a PIN typed for a person. Five wrong in a row lock them for five minutes, during which
 * even the right PIN is refused; once the lock is over, or after a right PIN, the count starts
 * again. The count is kept on this device.
 */
export async function checkPin(
  db: MarketDb,
  staffId: string,
  pin: string,
  at: Date,
): Promise<PinCheck> {
  const staff = await requireStaff(db, staffId);
  if (staff.archivedAt) {
    return { ok: false, reason: 'inactive' };
  }
  const lock = readLock((await db.meta.get(lockKey(staffId)))?.value);
  if (lock.lockedUntil !== undefined && at.getTime() < Date.parse(lock.lockedUntil)) {
    return { ok: false, reason: 'locked', until: lock.lockedUntil };
  }
  const right = await verifyPin(pin, {
    hash: staff.pinHash,
    salt: staff.pinSalt,
    iterations: staff.pinIterations,
  });
  if (right) {
    await db.meta.delete(lockKey(staffId));
    return { ok: true, staff };
  }
  // A lock that has run out starts the count again.
  const failures = (lock.lockedUntil === undefined ? lock.failures : 0) + 1;
  if (failures >= MAX_FAILURES) {
    const until = new Date(at.getTime() + LOCK_MS).toISOString();
    await db.meta.put({ key: lockKey(staffId), value: { failures: 0, lockedUntil: until } });
    return { ok: false, reason: 'locked', until };
  }
  await db.meta.put({ key: lockKey(staffId), value: { failures } });
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_FAILURES - failures };
}

async function save(
  db: MarketDb,
  current: StaffRecord,
  changes: Partial<StaffRecord>,
  at: Date,
): Promise<StaffRecord> {
  const stamp = at.toISOString();
  const changed = changedFields(current, changes);
  const updated = withoutUndefined({ ...current, ...changed, updatedAt: stamp });
  await db.staff.put(updated);
  await appendOutbox(
    db,
    { kind: 'patch', table: 'staff', recordId: current.id, patch: toPatch(changed, stamp) },
    at,
  );
  return updated;
}

async function activeOwners(db: MarketDb): Promise<StaffRecord[]> {
  return (await db.staff.toArray()).filter(
    (person) => person.role === 'owner' && !person.archivedAt,
  );
}

async function assertNotLastOwner(db: MarketDb, person: StaffRecord): Promise<void> {
  if (person.role !== 'owner' || person.archivedAt) {
    return;
  }
  const others = (await activeOwners(db)).filter((owner) => owner.id !== person.id);
  if (others.length === 0) {
    throw new LastOwnerError();
  }
}

async function requireStaff(db: MarketDb, id: string): Promise<StaffRecord> {
  const person = await db.staff.get(id);
  if (!person) {
    throw new RecordNotFoundError('Staff', id);
  }
  return person;
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) {
    throw new RangeError(`A name is 1 to ${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

function requirePin(pin: string): string {
  if (!isValidPin(pin)) {
    throw new RangeError('A PIN is four to six digits');
  }
  return pin;
}

function assertRole(role: Role): void {
  if (!ROLES.includes(role)) {
    throw new RangeError(`Unknown role: ${String(role)}`);
  }
}

/** Known permissions with a yes or no only; nothing left means the role decides everything. */
function cleanPermissions(
  permissions: Partial<Record<Permission, boolean>> | undefined,
): Partial<Record<Permission, boolean>> | undefined {
  const kept = Object.fromEntries(
    Object.entries(permissions ?? {}).filter(
      ([key, value]) => PERMISSIONS.includes(key as Permission) && typeof value === 'boolean',
    ),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}

function readLock(value: unknown): { failures: number; lockedUntil?: string } {
  if (typeof value !== 'object' || value === null) {
    return { failures: 0 };
  }
  const { failures, lockedUntil } = value as Record<string, unknown>;
  return {
    failures: Number.isSafeInteger(failures) ? (failures as number) : 0,
    ...(typeof lockedUntil === 'string' ? { lockedUntil } : {}),
  };
}
