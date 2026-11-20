/** The operator panel's address within the app: `#/operator`. */
export const OPERATOR_HASH = '#/operator';

/** Whether the address opens the operator panel rather than the register. */
export function isOperatorHash(hash: string): boolean {
  return hash === OPERATOR_HASH || hash.startsWith(`${OPERATOR_HASH}/`);
}
