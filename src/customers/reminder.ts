import { formatTRY, type Kurus } from '@/domain/money';

/** The WhatsApp message that reminds a customer of a debt; the shopkeeper sends it by hand. */
export function reminderText({
  marketName,
  customerName,
  balance,
  debtAgeDays,
}: {
  marketName: string;
  customerName: string;
  balance: Kurus;
  debtAgeDays: number;
}): string {
  const age = debtAgeDays > 0 ? ` (${debtAgeDays} gündür)` : '';
  return (
    `Merhaba ${customerName}, ${marketName} hesabınızda ${formatTRY(balance)} borç görünüyor${age}. ` +
    'Uygun olduğunuzda ödeyebilirsiniz. İyi günler.'
  );
}
