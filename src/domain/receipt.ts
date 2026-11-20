const DEVICE_CODE = /^[A-Z][A-Z0-9]{0,3}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Receipt number unique across devices by construction, e.g. K1-20261028-0042. */
export function formatReceiptNo(deviceCode: string, businessDate: string, seq: number): string {
  if (!DEVICE_CODE.test(deviceCode)) {
    throw new RangeError(`Device code must match ${DEVICE_CODE}, got "${deviceCode}"`);
  }
  if (!BUSINESS_DATE.test(businessDate)) {
    throw new RangeError(`Business date must be YYYY-MM-DD, got "${businessDate}"`);
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`Receipt sequence must be a positive integer, got ${seq}`);
  }
  return `${deviceCode}-${businessDate.replaceAll('-', '')}-${String(seq).padStart(4, '0')}`;
}

/**
 * Next sequence for a receipt on one business day. Pass the highest sequence this device has
 * already issued on that same day (null when none), never the device's latest receipt: when
 * the clock moves back to an earlier day, the latest receipt belongs to another day and its
 * sequence says nothing about which numbers that earlier day has used.
 */
export function nextReceiptSeq(highestSeqThatDay: number | null): number {
  if (highestSeqThatDay === null) {
    return 1;
  }
  if (!Number.isSafeInteger(highestSeqThatDay) || highestSeqThatDay < 1) {
    throw new RangeError(
      `The highest sequence must be a positive integer, got ${highestSeqThatDay}`,
    );
  }
  return highestSeqThatDay + 1;
}
