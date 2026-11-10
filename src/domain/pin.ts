/** How a PIN is kept: the PBKDF2-SHA256 result, its salt (both base64) and its rounds. */
export type PinHash = { hash: string; salt: string; iterations: number };

/** DESIGN §8.3 asks for at least 100,000; a little more costs a cashier nothing. */
export const PIN_ITERATIONS = 150_000;
const MIN_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const PIN = /^\d{4,6}$/;

/** Four to six digits, 0–9 only. */
export function isValidPin(pin: string): boolean {
  return PIN.test(pin);
}

/**
 * Hashes a PIN with PBKDF2-SHA256: a new random salt for each person, or the given one (base64)
 * to check a PIN against a stored hash.
 */
export async function hashPin(
  pin: string,
  salt?: string,
  iterations: number = PIN_ITERATIONS,
): Promise<PinHash> {
  if (!isValidPin(pin)) {
    throw new RangeError('A PIN is four to six digits');
  }
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS) {
    throw new RangeError(`A PIN hash takes at least ${MIN_ITERATIONS} rounds, got ${iterations}`);
  }
  const saltBytes = salt === undefined ? randomSalt() : fromBase64(salt);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    HASH_BITS,
  );
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(saltBytes), iterations };
}

/** Whether a PIN matches a stored hash; a malformed hash matches nothing. */
export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  if (!isValidPin(pin)) {
    return false;
  }
  try {
    const { hash } = await hashPin(pin, stored.salt, stored.iterations);
    return sameText(hash, stored.hash);
  } catch {
    return false;
  }
}

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

// Compares every character whatever the first difference, so timing says nothing of the hash.
function sameText(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
