import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { APP_VERSION } from '@/app/version';
import { backupFileName, marketBackup } from '@/data/backup';
import { Button } from '@/design';
import { downloadText } from '@/products/exportCsv';
import { SettingsSection } from './MarketSections';

const saveJson = (fileName: string, text: string) =>
  downloadText(fileName, text, 'application/json;charset=utf-8');

/**
 * "Yedek al": the whole market as this register holds it, saved as one file the owner keeps
 * somewhere safe (a USB stick, their e-mail, Drive). It works without internet, since every
 * register keeps the whole market.
 */
export function BackupSection({
  save = saveJson,
  now = () => new Date(),
}: {
  save?: (fileName: string, text: string) => void;
  now?: () => Date;
}): JSX.Element {
  const { db, settings } = useData();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string>();

  async function takeBackup() {
    setBusy(true);
    setLine(undefined);
    try {
      const at = now();
      const backup = await marketBackup(db, {
        marketId: settings.marketId,
        marketName: settings.marketName,
        appVersion: APP_VERSION,
        now: at,
      });
      save(backupFileName(settings.marketId, at), JSON.stringify(backup));
      const count = (name: string) => backup.tables[name]?.length ?? 0;
      setLine(
        `Yedek kaydedildi: ${count('products')} ürün, ${count('sales')} satış, ${count('customers')} müşteri.`,
      );
    } catch {
      setLine('Yedek alınamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      id="backup-heading"
      title="Yedek"
      description="Marketin bütün verisi tek dosyada: ürünler, satışlar, veresiye, tedarikçiler. Dosyayı bir USB belleğe ya da e-postanıza koyun."
      action={
        <Button onClick={() => void takeBackup()} disabled={busy}>
          Yedek al
        </Button>
      }
    >
      {line ? (
        <p role="status" className="text-text-2">
          {line}
        </p>
      ) : null}
    </SettingsSection>
  );
}
