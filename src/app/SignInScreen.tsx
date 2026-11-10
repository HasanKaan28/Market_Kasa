import { Delete } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';
import { checkPin } from '@/data/staff';
import type { StaffRecord } from '@/data/types';
import { Button, TextField } from '@/design';
import { ROLE_LABELS } from '@/domain/permissions';
import { isValidPin } from '@/domain/pin';
import { formatTime } from '@/pos/format';
import { useData } from './appData';

const MAX_PIN_LENGTH = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** The register's door: pick who you are, then type your PIN, on the keyboard or the keypad. */
export function SignInScreen({
  people,
  onSignedIn,
}: {
  people: readonly StaffRecord[];
  onSignedIn(staff: StaffRecord): void;
}): JSX.Element {
  const { db, settings } = useData();
  const [chosenId, setChosenId] = useState<string | null>(
    people.length === 1 ? (people[0]?.id ?? null) : null,
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const chosen = people.find((person) => person.id === chosenId) ?? null;

  function choose(person: StaffRecord | null) {
    setChosenId(person?.id ?? null);
    setPin('');
    setError(undefined);
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!chosen || checking) {
      return;
    }
    if (!isValidPin(pin)) {
      setError('PIN 4–6 rakamdır.');
      return;
    }
    setChecking(true);
    try {
      const result = await checkPin(db, chosen.id, pin, new Date());
      if (result.ok) {
        onSignedIn(result.staff);
        return;
      }
      setPin('');
      setError(
        result.reason === 'wrong'
          ? `PIN yanlış. ${result.attemptsLeft} deneme kaldı.`
          : result.reason === 'locked'
            ? `Çok fazla hatalı deneme. Kilidin bitişi: ${formatTime(result.until)}.`
            : 'Bu kişi artık giriş yapamaz.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <section className="flex w-full max-w-[420px] flex-col gap-5 rounded-control border border-line bg-surface p-6">
        <header className="flex flex-col gap-1">
          <p className="text-sm text-text-2">{`${settings.marketName} · ${settings.deviceName}`}</p>
          <h1 className="text-xl font-semibold">Kim kasada?</h1>
        </header>
        {chosen === null ? (
          <ul className="grid grid-cols-2 gap-2">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => choose(person)}
                  className="flex min-h-16 w-full flex-col items-start justify-center rounded-control border border-line-strong px-4 py-2 text-left hover:bg-bg"
                >
                  <span className="font-semibold">{person.name}</span>
                  <span className="text-sm text-text-2">{ROLE_LABELS[person.role]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
            <div className="flex items-center justify-between gap-3">
              <p>
                <span className="font-semibold">{chosen.name}</span>
                <span className="text-text-2">{` · ${ROLE_LABELS[chosen.role]}`}</span>
              </p>
              {people.length > 1 ? (
                <Button variant="ghost" onClick={() => choose(null)}>
                  Başka kişi
                </Button>
              ) : null}
            </div>
            <TextField
              label="PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={MAX_PIN_LENGTH}
              value={pin}
              error={error}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((key) => (
                <Button
                  key={key}
                  size="lg"
                  onClick={() => setPin((typed) => (typed + key).slice(0, MAX_PIN_LENGTH))}
                >
                  {key}
                </Button>
              ))}
              <Button
                size="lg"
                aria-label="Sil"
                icon={<Delete aria-hidden="true" size={20} />}
                onClick={() => setPin((typed) => typed.slice(0, -1))}
              />
              <Button
                size="lg"
                onClick={() => setPin((typed) => (typed + '0').slice(0, MAX_PIN_LENGTH))}
              >
                0
              </Button>
              <Button type="submit" variant="primary" size="lg" disabled={checking}>
                Giriş
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
