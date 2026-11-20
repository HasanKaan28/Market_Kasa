import { ArrowLeft } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';
import { Button, TextField } from '@/design';
import { messageOf, type Device, type MarketDetail as Detail, type OperatorApi } from './api';
import {
  actionDetail,
  actionLabel,
  agoText,
  bytesText,
  countText,
  dateTimeText,
  dayText,
  moneyText,
  planDateText,
  platformLabel,
  tableLabel,
} from './model';
import { TONES, useLoad } from './load';
import { Alert, ConfirmDialog, CopyButton, Loading, Panel, Row, TextArea } from './ui';

/**
 * One market as the operator looks after it: who runs it and how it was opened, how it is used
 * (counts and totals only), its registers, the operator's own plan record and note, the last
 * changes made to it, and its state, which changes only behind a confirmation.
 */
export function MarketDetail({
  api,
  marketId,
  onBack,
  notify,
  now = () => new Date(),
}: {
  api: OperatorApi;
  marketId: string;
  onBack(): void;
  notify(message: string): void;
  now?: () => Date;
}): JSX.Element {
  const detail = useLoad(() => api.market(marketId), `detail:${marketId}`);
  const history = useLoad(() => api.history({ limit: 10, marketId }), `history:${marketId}`);
  const changed = () => {
    detail.reload();
    history.reload();
  };
  const data = detail.data;
  const at = now();

  return (
    <article aria-labelledby="market-name" className="flex min-w-0 flex-col gap-4">
      <div>
        <Button
          variant="ghost"
          className="-ml-3"
          icon={<ArrowLeft aria-hidden="true" size={18} />}
          onClick={onBack}
        >
          Geri
        </Button>
      </div>
      {detail.error ? <Alert>{detail.error}</Alert> : null}
      {data === undefined && !detail.error ? <Loading /> : null}
      {data ? (
        <>
          <Heading detail={data} />
          <Info detail={data} now={at} />
          <Usage detail={data} />
          <Devices detail={data} api={api} now={at} notify={notify} onChanged={changed} />
          <Plan detail={data} api={api} now={at} notify={notify} onChanged={changed} />
          <Note detail={data} api={api} notify={notify} onChanged={changed} />
          <Panel title="Son işlemler" id="market-history">
            {history.error ? <Alert>{history.error}</Alert> : null}
            {history.data?.length === 0 ? (
              <p className="text-sm text-text-2">Bu markette henüz işlem yapılmadı.</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-line">
              {history.data?.map((entry) => {
                const text = actionDetail(entry.action, entry.details);
                return (
                  <li key={entry.id} className="flex flex-col gap-0.5 py-2 text-sm">
                    <span className="font-medium">{actionLabel(entry.action)}</span>
                    {text ? <span className="break-words text-text-2">{text}</span> : null}
                    <span className="text-meta text-muted">{dateTimeText(entry.at)}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Status detail={data} api={api} notify={notify} onChanged={changed} />
        </>
      ) : null}
    </article>
  );
}

function Heading({ detail }: { detail: Detail }): JSX.Element {
  const active = detail.status === 'active';
  return (
    <div className="flex flex-col gap-2">
      <h2
        id="market-name"
        className="font-display text-2xl font-semibold tracking-[-0.01em] break-words"
      >
        {detail.name}
      </h2>
      <div className="flex flex-wrap gap-2">
        <span
          className={`rounded-chip px-2.5 py-0.5 text-meta font-semibold ${
            active ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
          }`}
        >
          {active ? 'Etkin' : 'Askıda'}
        </span>
        {detail.info?.plan ? (
          <span className="rounded-chip bg-surface px-2.5 py-0.5 text-meta font-semibold text-text-2">
            {detail.info.plan}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const ROLES = { owner: 'Sahip', manager: 'Yönetici' } as const;

function Info({ detail, now }: { detail: Detail; now: Date }): JSX.Element {
  const live = detail.devices.filter((device) => device.revokedAt === null).length;
  return (
    <Panel title="Bilgiler" id="market-info">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {detail.people.length === 0 ? <Row label="Sahip">Hesap bağlı değil</Row> : null}
        {detail.people.map((person, index) => (
          <Row key={`${person.role}-${person.email ?? index}`} label={ROLES[person.role]}>
            <span className="break-all">{person.email ?? 'E-postasız hesap'}</span>
          </Row>
        ))}
        <Row label="Cihaz">{`${countText(live)} bağlı · ${countText(detail.activeDevices30)} son 30 günde`}</Row>
        <Row label="Personel">
          {`${countText(detail.staff.active)} kişi`}
          {detail.staff.archived > 0 ? (
            <span className="text-text-2">{` · ${countText(detail.staff.archived)} ayrılmış`}</span>
          ) : null}
        </Row>
        <Row label="Açılış">{dateTimeText(detail.createdAt)}</Row>
        <Row label="Kurulum kodu">
          {detail.activationCode ? (
            <>
              <span className="font-mono">{detail.activationCode}</span>
              {detail.code?.note ? (
                <span className="text-text-2">{` · ${detail.code.note}`}</span>
              ) : null}
            </>
          ) : (
            <span className="text-text-2">Kodlardan önce açıldı</span>
          )}
        </Row>
        <Row label="Son eşitleme">
          {detail.lastSyncAt
            ? `${agoText(detail.lastSyncAt, now)} · ${dateTimeText(detail.lastSyncAt)}`
            : 'Hiç'}
        </Row>
        <Row label="Son satış">
          {detail.lastSaleAt
            ? `${agoText(detail.lastSaleAt, now)} · ${dateTimeText(detail.lastSaleAt)}`
            : 'Hiç'}
        </Row>
        <Row label="Kimlik">
          <span className="font-mono text-meta break-all">{detail.id}</span>
        </Row>
      </dl>
    </Panel>
  );
}

function Usage({ detail }: { detail: Detail }): JSX.Element {
  const figures = [
    { label: 'Bugün', sum: detail.sales.today },
    { label: 'Son 30 gün', sum: detail.sales.last30 },
    { label: 'Tümü', sum: detail.sales.all },
  ];
  return (
    <Panel title="Satış" id="market-usage">
      <dl className="grid gap-2 sm:grid-cols-3">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex min-w-0 flex-col-reverse gap-0.5 rounded-control bg-bg px-3 py-2"
          >
            <dt className="text-meta text-text-2">
              {`${figure.label} · ${countText(figure.sum.count)} satış`}
            </dt>
            <dd className="truncate font-display text-xl font-semibold tabular-nums">
              {moneyText(figure.sum.total)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-text-2">
        {`Son 30 gün: ${countText(detail.voids30)} iptal · ${countText(detail.returns30.count)} iade (${moneyText(detail.returns30.total)})`}
      </p>
      <p className="text-meta text-muted">
        İptal edilen satışlar toplamlara katılmaz. Yalnız sayılar ve toplamlar gösterilir; fiş ya da
        müşteri ayrıntısı bu sayfaya gelmez.
      </p>
      {detail.rowCounts.length > 0 ? (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text-2 hover:text-text">
            {`Kayıt sayıları · ${bytesText(detail.bytes)}`}
          </summary>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 pt-1">
            {detail.rowCounts.map((row) => (
              <div key={row.table} className="contents">
                <dt className="text-text-2">{tableLabel(row.table)}</dt>
                <dd className="text-right tabular-nums">{countText(row.count)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : (
        <p className="text-sm text-text-2">Henüz eşitlenmiş kayıt yok.</p>
      )}
    </Panel>
  );
}

function Devices({
  detail,
  api,
  now,
  notify,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  now: Date;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  return (
    <Panel title="Cihazlar" id="market-devices">
      {detail.devices.length === 0 ? (
        <p className="text-sm text-text-2">Bu markete bağlı cihaz yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              marketName={detail.name}
              api={api}
              now={now}
              notify={notify}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DeviceRow({
  device,
  marketName,
  api,
  now,
  notify,
  onChanged,
}: {
  device: Device;
  marketName: string;
  api: OperatorApi;
  now: Date;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  const [revoking, setRevoking] = useState(false);
  const revoked = device.revokedAt !== null;
  const seen = agoText(device.lastSeenAt, now, 'hiç').toLocaleLowerCase('tr');

  return (
    <li
      aria-label={`${device.code} · ${device.name}`}
      className={`flex flex-col gap-1.5 rounded-control border border-line px-3 py-2.5 ${revoked ? 'bg-bg' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="rounded-chip bg-text px-2 py-0.5 font-mono text-meta font-medium text-surface">
          {device.code}
        </span>
        <span className={`font-semibold break-words ${revoked ? 'text-text-2 line-through' : ''}`}>
          {device.name}
        </span>
        {revoked ? (
          <span className="rounded-chip bg-surface px-2 py-0.5 text-meta font-semibold text-text-2">
            İptal edildi
          </span>
        ) : null}
      </div>
      <p className="text-meta text-text-2">
        {`${platformLabel(device.platform)} · eklendi ${dayText(device.createdAt)} · ${
          revoked && device.revokedAt ? `iptal ${dayText(device.revokedAt)}` : `son görülme ${seen}`
        }`}
      </p>
      {revoked ? null : (
        <div className="-ml-2">
          <Button variant="ghost" className="text-danger!" onClick={() => setRevoking(true)}>
            Cihazı iptal et…
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={revoking}
        title="Cihaz iptal edilsin mi?"
        description={`${marketName}: ${device.code} · ${device.name} bir sonraki eşitlemede reddedilir. Cihazdaki kayıtlar silinmez; sahip yeniden bağlayabilir.`}
        confirmLabel="Cihazı iptal et"
        onClose={() => setRevoking(false)}
        onConfirm={async () => {
          await api.revokeDevice(device.id);
          notify(`${device.code} iptal edildi.`);
          onChanged();
        }}
      />
    </li>
  );
}

function Plan({
  detail,
  api,
  now,
  notify,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  now: Date;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  const [plan, setPlan] = useState(detail.info?.plan ?? '');
  const [until, setUntil] = useState(detail.info?.planUntil ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const saved = detail.info?.planUntil ? planDateText(detail.info.planUntil, now) : null;
  const unchanged =
    plan.trim() === (detail.info?.plan ?? '') && until === (detail.info?.planUntil ?? '');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (until !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      setError('Bir gün seçin.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.setPlan(detail.id, plan.trim(), until === '' ? null : until);
      notify('Paket kaydedildi.');
      onChanged();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Paket" id="market-plan">
      <p className="text-meta text-muted">
        Yalnız sizin kaydınız: markete, cihazlara ve eşitlemeye hiçbir kısıt getirmez.
      </p>
      {saved && detail.info?.planUntil ? (
        <p className="text-sm">
          <span className={`font-medium ${TONES[saved.tone]}`}>{saved.text}</span>
          <span className="text-text-2">{` · ${dayText(detail.info.planUntil)}`}</span>
        </p>
      ) : null}
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <TextField
            label="Paket adı"
            hint="ör. Yıllık, Deneme"
            maxLength={40}
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
          />
          <TextField
            label="Tarih"
            hint="ör. ödemenin biteceği gün"
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <div className="grid gap-2 sm:flex">
          <Button type="submit" variant="primary" disabled={busy || unchanged}>
            Paketi kaydet
          </Button>
          {until !== '' ? (
            <Button variant="ghost" disabled={busy} onClick={() => setUntil('')}>
              Tarihi temizle
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

function Note({
  detail,
  api,
  notify,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  const [note, setNote] = useState(detail.info?.note ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.setNote(detail.id, note);
      notify(note.trim() ? 'Not kaydedildi.' : 'Not silindi.');
      onChanged();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Özel not" id="market-note">
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <TextArea
          label="Not"
          hint="Yalnız siz görürsünüz; market ve cihazları görmez."
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || note.trim() === (detail.info?.note ?? '')}
        >
          Notu kaydet
        </Button>
      </form>
    </Panel>
  );
}

function Status({
  detail,
  api,
  notify,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  notify(message: string): void;
  onChanged(): void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const active = detail.status === 'active';
  return (
    <Panel title="Durum" id="market-status" tone="danger">
      <p className="text-sm text-text-2">
        {active
          ? 'Etkin: cihazlar eşitleniyor.'
          : 'Askıda: cihazlar eşitlenmiyor, çevrimdışı satış sürüyor. Etkinleştirince kaldığı yerden sürer.'}
      </p>
      <div className="grid gap-2 sm:flex">
        <Button variant={active ? 'danger' : 'primary'} onClick={() => setAsking(true)}>
          {active ? 'Askıya al…' : 'Etkinleştir…'}
        </Button>
        <CopyButton variant="ghost" text={detail.id} label="Kimliği kopyala" />
      </div>
      <ConfirmDialog
        open={asking}
        title={active ? 'Market askıya alınsın mı?' : 'Market etkinleştirilsin mi?'}
        description={
          active
            ? `${detail.name}: cihazlar eşitlenemez, yeni cihaz bağlanamaz. Satış çevrimdışı sürer; kayıtlar silinmez.`
            : `${detail.name}: cihazlar yeniden eşitlenir.`
        }
        confirmLabel={active ? 'Askıya al' : 'Etkinleştir'}
        danger={active}
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          await api.setMarketStatus(detail.id, active ? 'suspended' : 'active');
          notify(active ? 'Market askıya alındı.' : 'Market etkinleştirildi.');
          onChanged();
        }}
      />
    </Panel>
  );
}
