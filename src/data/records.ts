/** The entries of `changes` whose value differs from the current record. */
export function changedFields<T extends object>(
  current: T,
  changes: Partial<T>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(changes).filter(([key, value]) => current[key as keyof T] !== value),
  );
}

/** The outbox patch for a change: a cleared optional field travels as null, because JSON has no undefined. */
export function toPatch(changed: Record<string, unknown>, stamp: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changed)) {
    patch[key] = value === undefined ? null : value;
  }
  return { ...patch, updatedAt: stamp };
}

export function withoutUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
