import Dexie from 'dexie';
import { businessDate, businessDayStart } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { buildSummary, loadRange, type Summary, type SummaryInput } from '@/reports/summary';
import type { MarketDb } from './db';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { refundsOf } from './returns';
import { withoutUndefined } from './records';
import type { CashBreakdown, CashMovementRecord, CashSessionRecord, Payment } from './types';

/** A drawer as opened on this device; it stays here, unsynced, until the day is closed. */
export type OpenCashSession = {
  id: string;
  deviceCode: string;
  openedAt: string;
  openingCash: Kurus;
};

export type CashMovementInput = {
  deviceCode: string;
  kind: 'in' | 'out';
  /** Above zero; `kind` says which way. */
  amount: Kurus;
  reason: string;
  refId?: string;
  staffId?: string;
  cutoffMinutes?: number;
};

export type ExpectedCash = CashBreakdown & {
  /** The open drawer; absent when it was not opened, and then the opening cash counts as 0. */
  session?: OpenCashSession;
  /** Where the count starts: the last close, else the start of the day or an earlier opening. */
  since: string;
  /** The register's last Z, when there is one. */
  lastCloseAt?: string;
  expected: Kurus;
};

const sessionKey = (deviceCode: string) => `cashSession:${deviceCode}`;
// Above every ISO timestamp: an open end for a range of instants.
const LATEST = '\uffff';

/** The drawer open on this register, if any. */
export async function currentCashSession(
  db: MarketDb,
  deviceCode: string,
): Promise<OpenCashSession | undefined> {
  const value = (await db.meta.get(sessionKey(deviceCode)))?.value;
  return isOpenSession(value) && value.deviceCode === deviceCode ? value : undefined;
}

/** Opens the register's drawer with the cash counted into it; a drawer opens only once a day. */
export async function openCashSession(
  db: MarketDb,
  { deviceCode, openingCash }: { deviceCode: string; openingCash: Kurus },
  at: Date,
): Promise<OpenCashSession> {
  assertSafeInteger(openingCash, 'Opening cash');
  if (openingCash < 0) {
    throw new RangeError(`Opening cash cannot be below zero, got ${openingCash}`);
  }
  return db.transaction('rw', db.meta, async () => {
    if (await currentCashSession(db, deviceCode)) {
      throw new RangeError(`The drawer of ${deviceCode} is already open`);
    }
    const session: OpenCashSession = {
      id: newId(at.getTime()),
      deviceCode,
      openedAt: at.toISOString(),
      openingCash,
    };
    await db.meta.put({ key: sessionKey(deviceCode), value: session });
    return session;
  });
}

/** Puts cash into the drawer or takes it out, with the reason, in one transaction. */
export async function recordCashMovement(
  db: MarketDb,
  input: CashMovementInput,
  at: Date,
): Promise<CashMovementRecord> {
  assertMovement(input);
  return db.transaction('rw', db.cashMovements, db.outbox, db.meta, () =>
    addCashMovement(db, input, at),
  );
}

/**
 * Writes one cash movement and queues it, in the open session if there is one. It runs inside
 * the caller's transaction, which must include `cashMovements`, `outbox` and `meta`.
 */
export async function addCashMovement(
  db: MarketDb,
  input: CashMovementInput,
  at: Date,
): Promise<CashMovementRecord> {
  assertMovement(input);
  const session = await currentCashSession(db, input.deviceCode);
  const record: CashMovementRecord = withoutUndefined({
    id: newId(at.getTime()),
    deviceCode: input.deviceCode,
    sessionId: session?.id,
    kind: input.kind,
    amount: input.amount,
    reason: input.reason.trim(),
    refId: input.refId,
    staffId: input.staffId,
    occurredAt: at.toISOString(),
    businessDate: businessDate(at, { cutoffMinutes: input.cutoffMinutes }),
  });
  await db.cashMovements.add(record);
  await appendOutbox(
    db,
    { kind: 'insert', table: 'cashMovements', recordId: record.id, record },
    at,
  );
  return record;
}

/**
 * The cash the register's drawer should hold at `at`: the opening cash, plus the cash part of
 * the register's sales, less the cash part of the sales voided on it (those of earlier days too)
 * and the cash refunded on it, plus money put in, less money taken out. A Z covers everything this
 * register did since its last Z, opened or not: the opening cash is the float put in at the start,
 * not a count, so what was sold before the opening is still counted. A register that has never
 * closed counts from the start of the business day, or from its opening if that was earlier, so a
 * first close does not sweep up the register's whole history.
 * Without `at` it counts everything so far, and a live query of it sees every later record too:
 * a query bounded by the time it ran watches only up to that time.
 */
export async function expectedCash(
  db: MarketDb,
  deviceCode: string,
  at?: Date,
  opts: { cutoffMinutes?: number } = {},
): Promise<ExpectedCash> {
  return (await countDrawer(db, deviceCode, at, opts.cutoffMinutes)).cash;
}

/**
 * Closes the register's day: works out the expected cash and the sales summary, and writes them
 * with the counted cash as one Z record, closing the open drawer, in one transaction.
 */
export async function closeCashSession(
  db: MarketDb,
  {
    deviceCode,
    countedCash,
    staffId,
    cutoffMinutes,
  }: { deviceCode: string; countedCash: Kurus; staffId?: string; cutoffMinutes?: number },
  at: Date,
): Promise<CashSessionRecord> {
  assertSafeInteger(countedCash, 'Counted cash');
  if (countedCash < 0) {
    throw new RangeError(`Counted cash cannot be below zero, got ${countedCash}`);
  }
  const tables = [
    db.meta,
    db.cashSessions,
    db.cashMovements,
    db.sales,
    db.saleVoids,
    db.returns,
    db.products,
    db.categories,
    db.staff,
    db.outbox,
  ];
  return db.transaction('rw', tables, async () => {
    const { cash, records } = await countDrawer(db, deviceCode, at, cutoffMinutes);
    const [products, categories, staff] = await Promise.all([
      db.products.toArray(),
      db.categories.toArray(),
      db.staff.toArray(),
    ]);
    const summary = withoutProductsSold(buildSummary({ ...records, products, categories, staff }));
    const { session, expected } = cash;
    const record: CashSessionRecord = withoutUndefined({
      id: session?.id ?? newId(at.getTime()),
      deviceCode,
      openedAt: session?.openedAt,
      openingCash: session?.openingCash ?? 0,
      closedAt: at.toISOString(),
      cash: {
        sales: cash.sales,
        voids: cash.voids,
        refunds: cash.refunds,
        movementsIn: cash.movementsIn,
        movementsOut: cash.movementsOut,
      },
      expectedCash: expected,
      countedCash,
      difference: countedCash - expected,
      summary,
      staffId,
      businessDate: businessDate(at, { cutoffMinutes }),
    });
    await db.cashSessions.add(record);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'cashSessions', recordId: record.id, record },
      at,
    );
    await db.meta.delete(sessionKey(deviceCode));
    return record;
  });
}

/** The drawer's count and the records it was made from, read in one transaction. */
async function countDrawer(
  db: MarketDb,
  deviceCode: string,
  at: Date | undefined,
  cutoffMinutes = 0,
): Promise<{
  cash: ExpectedCash;
  records: Pick<SummaryInput, 'sales' | 'voids' | 'returns' | 'salesById'>;
}> {
  const tables = [db.meta, db.cashSessions, db.cashMovements, db.sales, db.saleVoids, db.returns];
  return db.transaction('r', tables, async () => {
    const session = await currentCashSession(db, deviceCode);
    const last = await lastClose(db, deviceCode);
    const dayStart = businessDayStart(businessDate(at ?? new Date(), { cutoffMinutes }), {
      cutoffMinutes,
    }).toISOString();
    const opened = session?.openedAt;
    const from = last
      ? last.closedAt
      : opened !== undefined && opened < dayStart
        ? opened
        : dayStart;
    // A close already counted what happened at its own instant.
    const includeFrom = last === undefined;
    const until = at?.toISOString() ?? LATEST;
    const records = await loadRange(db, {
      index: 'occurredAt',
      from,
      to: until,
      includeFrom,
      deviceCode,
    });
    const movements = await db.cashMovements
      .where('[deviceCode+occurredAt]')
      .between([deviceCode, from], [deviceCode, until], includeFrom, true)
      .toArray();
    const sum = (amounts: readonly number[]) =>
      amounts.reduce((total, amount) => total + amount, 0);
    const breakdown: CashBreakdown = {
      sales: sum(records.sales.map((sale) => cashOf(sale.payments))),
      voids: sum(
        records.voids.map((saleVoid) =>
          cashOf(records.salesById.get(saleVoid.saleId)?.payments ?? []),
        ),
      ),
      refunds: cashOf(refundsOf(records.returns)),
      movementsIn: sum(movements.filter((m) => m.kind === 'in').map((m) => m.amount)),
      movementsOut: sum(movements.filter((m) => m.kind === 'out').map((m) => m.amount)),
    };
    const expected =
      (session?.openingCash ?? 0) +
      breakdown.sales -
      breakdown.voids -
      breakdown.refunds +
      breakdown.movementsIn -
      breakdown.movementsOut;
    return {
      cash: withoutUndefined({
        session,
        since: from,
        lastCloseAt: last?.closedAt,
        ...breakdown,
        expected,
      }),
      records,
    };
  });
}

/** The register's most recent Z record. */
async function lastClose(db: MarketDb, deviceCode: string): Promise<CashSessionRecord | undefined> {
  return db.cashSessions
    .where('[deviceCode+closedAt]')
    .between([deviceCode, Dexie.minKey], [deviceCode, Dexie.maxKey])
    .last();
}

/** The Z keeps the best sellers; every product sold is left to the reports, to keep it small. */
function withoutProductsSold(summary: Summary): CashSessionRecord['summary'] {
  const kept: Partial<Summary> = { ...summary };
  delete kept.productsSold;
  return kept as CashSessionRecord['summary'];
}

function cashOf(payments: readonly Payment[]): Kurus {
  return payments
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + payment.amount, 0);
}

function assertMovement(input: CashMovementInput): void {
  assertSafeInteger(input.amount, 'Cash movement');
  if (input.amount <= 0) {
    throw new RangeError(`A cash movement must be above zero, got ${input.amount}`);
  }
  if (input.kind !== 'in' && input.kind !== 'out') {
    throw new RangeError(`A cash movement goes in or out, got ${String(input.kind)}`);
  }
  if (input.reason.trim() === '') {
    throw new RangeError('A cash movement needs a reason');
  }
  if (!input.deviceCode) {
    throw new RangeError('A cash movement needs its register');
  }
}

function isOpenSession(value: unknown): value is OpenCashSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { id, deviceCode, openedAt, openingCash } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    typeof deviceCode === 'string' &&
    typeof openedAt === 'string' &&
    Number.isSafeInteger(openingCash)
  );
}
