import { describe, expect, it } from 'vitest';
import { reminderText } from './reminder';

describe('reminderText', () => {
  it('writes the reminder with balance and age', () => {
    const base = { marketName: 'Kurşunlu Market', customerName: 'Ahmet', balance: 42500 };
    expect(reminderText({ ...base, debtAgeDays: 12 })).toBe(
      'Merhaba Ahmet, Kurşunlu Market hesabınızda ₺425,00 borç görünüyor (12 gündür). ' +
        'Uygun olduğunuzda ödeyebilirsiniz. İyi günler.',
    );
    expect(reminderText({ ...base, debtAgeDays: 0 })).toBe(
      'Merhaba Ahmet, Kurşunlu Market hesabınızda ₺425,00 borç görünüyor. ' +
        'Uygun olduğunuzda ödeyebilirsiniz. İyi günler.',
    );
  });
});
