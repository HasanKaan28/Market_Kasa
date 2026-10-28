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

/** Sequences restart at 1 on every new business day. */
export function nextReceiptSeq(
  last: { businessDate: string; seq: number } | null,
  businessDate: string,
): number {
  return last !== null && last.businessDate === businessDate ? last.seq + 1 : 1;
}
