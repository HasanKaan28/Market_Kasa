import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdateSection, type DesktopUpdates, type UpdateStatus } from './UpdateSection';

function desktop() {
  let listener: ((status: UpdateStatus) => void) | undefined;
  const bridge: DesktopUpdates = {
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    defer: vi.fn(async () => undefined),
    onStatus(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return { bridge, emit: (status: UpdateStatus) => act(() => listener?.(status)) };
}

describe('UpdateSection', () => {
  it('offers a newer desktop version and installs it', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateSection version="2.0.0" desktop={bridge} />);
    expect(bridge.check).toHaveBeenCalled();
    expect(screen.getByText('Sürüm 2.0.0')).toBeInTheDocument();

    emit({ kind: 'available', version: '2.0.1' });
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle (2.0.1)' }));
    expect(bridge.install).toHaveBeenCalled();

    emit({ kind: 'downloading', percent: 42 });
    expect(screen.getByRole('status')).toHaveTextContent('İndiriliyor %42');
    emit({ kind: 'installing', version: '2.0.1' });
    expect(screen.getByRole('status')).toHaveTextContent('Kuruluyor; uygulama yeniden açılacak.');
  });

  it('says a downloaded update goes in when the app closes, and installs it now on a press', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateSection version="2.0.4" desktop={bridge} />);
    emit({ kind: 'ready', version: '2.0.5' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sürüm 2.0.5 indirildi; program kapanınca kendiliğinden kurulur.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Şimdi kur (2.0.5)' }));
    expect(bridge.install).toHaveBeenCalled();
  });

  it('says the desktop app is up to date or could not check', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateSection version="2.0.0" desktop={bridge} />);
    emit({ kind: 'current' });
    expect(screen.getByRole('status')).toHaveTextContent('Güncel');
    emit({ kind: 'error' });
    expect(screen.getByRole('status')).toHaveTextContent('Güncelleme denetlenemedi.');
    await userEvent.click(screen.getByRole('button', { name: 'Denetle' }));
    expect(bridge.check).toHaveBeenCalledTimes(2);
  });

  it('links a newer Android version for download', async () => {
    const latest = vi.fn(async () => '2.1.0');
    render(<UpdateSection version="2.0.0" android latestVersion={latest} />);
    const link = await screen.findByRole('link', { name: 'Yeni sürümü indir (2.1.0)' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/HasanKaan28/Market_Kasa/releases/latest/download/Market-Kasa.apk',
    );
  });

  it('says an Android phone is up to date', async () => {
    render(<UpdateSection version="2.1.0" android latestVersion={async () => '2.1.0'} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Güncel');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stays out of the web app, which updates itself', () => {
    const { container } = render(<UpdateSection version="2.0.0" />);
    expect(container).toBeEmptyDOMElement();
  });
});
