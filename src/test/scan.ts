import userEvent from '@testing-library/user-event';

/**
 * Sends a code the way a keyboard-wedge scanner does: Shift held around each capital letter,
 * every key in one quick burst, then Enter. The characters land in whatever field has focus,
 * as they do in a browser, so a test can check that the scanner takes them back out.
 */
export async function scan(code: string): Promise<void> {
  const keys = Array.from(code, (char) => (/[A-Z]/.test(char) ? `{Shift>}${char}{/Shift}` : char));
  await userEvent.setup({ delay: null }).keyboard(`${keys.join('')}{Enter}`);
}
