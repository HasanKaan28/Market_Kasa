/**
 * Activation codes as the operator hands them out: eight Crockford base32 characters in two
 * groups of four (ABCD-2345), without I, L, O or U. What a person types is read as Crockford
 * reads it (O as zero, I or L as one); the server does the same, however the code arrives.
 */

const LENGTH = 8;
const NOT_IN_CODE = /[^0-9A-HJKMNP-TV-Z]/g;

/** What the field shows: up to eight capitals, grouped in fours. */
export function typedActivationCode(input: string): string {
  const chars = input
    .replace(/ı/g, 'I')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(NOT_IN_CODE, '')
    .slice(0, LENGTH);
  return (chars.match(/.{1,4}/g) ?? []).join('-');
}

/** The whole code to send to the server, or null while characters are missing. */
export function activationCodeOf(typed: string): string | null {
  const code = typedActivationCode(typed);
  return code.length === LENGTH + 1 ? code : null;
}
