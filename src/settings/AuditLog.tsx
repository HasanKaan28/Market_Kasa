import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import { latestAudit } from '@/data/audit';
import { formatDateTime } from '@/pos/format';
import { describeAudit } from './auditText';
import { SettingsSection } from './MarketSections';

/** The newest management actions: when, who, on which register, and what changed. */
export function AuditLog(): JSX.Element {
  const { db } = useData();
  const view = useLiveQuery(async () => {
    const [entries, people, products] = await Promise.all([
      latestAudit(db),
      db.staff.toArray(),
      db.products.toArray(),
    ]);
    return {
      entries,
      staff: new Map(people.map((person) => [person.id, person.name])),
      products: new Map(products.map((product) => [product.id, product.name])),
    };
  }, [db]);
  const names = {
    staff: (id: string | undefined) => (id ? (view?.staff.get(id) ?? 'Silinmiş kişi') : '—'),
    product: (id: string | undefined) => (id ? (view?.products.get(id) ?? 'Silinmiş ürün') : '—'),
  };

  return (
    <SettingsSection
      id="audit-heading"
      title="İz kaydı"
      description="Personel, ayar ve fiyat değişiklikleri ile yetkili onayları; en yeni 200 kayıt."
    >
      {view === undefined ? null : view.entries.length === 0 ? (
        <p className="text-text-2">Henüz kayıt yok.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line-strong text-sm text-text-2">
              <th scope="col" className="py-2 pr-3 font-medium">
                Zaman
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Kişi
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Kasa
              </th>
              <th scope="col" className="py-2 font-medium">
                İşlem
              </th>
            </tr>
          </thead>
          <tbody>
            {view.entries.map((entry) => (
              <tr key={entry.id} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap text-text-2">
                  {formatDateTime(entry.occurredAt)}
                </td>
                <td className="py-2 pr-3">{names.staff(entry.staffId)}</td>
                <td className="py-2 pr-3 text-text-2">{entry.deviceCode}</td>
                <td className="py-2">{describeAudit(entry, names)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SettingsSection>
  );
}
