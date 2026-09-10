import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Zap, ZapOff, RefreshCw, Scan, Volume2 } from 'lucide-react';
import { playBarcodeBeep } from '../utils/sound';

export default function BarcodeScanner({ onScan, onClose, continuous = true }) {
  const [error, setError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [lastScanned, setLastScanned] = useState(null);
  const scannerRef = useRef(null);
  const lastScanTimeRef = useRef(0);
  const lastBarcodeRef = useRef('');

  useEffect(() => {
    let html5QrCode;
    const scannerElementId = 'barcode-reader-viewport';

    async function startScanner() {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!devices || devices.length === 0) {
          setError('Kamera bulunamadı. Lütfen kamera izinlerini kontrol edin.');
          return;
        }

        setCameras(devices);
        
        // Select back camera preferentially
        const backCameraIndex = devices.findIndex(c => 
          c.label.toLowerCase().includes('back') || 
          c.label.toLowerCase().includes('rear') || 
          c.label.toLowerCase().includes('environment')
        );
        const selectedIndex = backCameraIndex !== -1 ? backCameraIndex : 0;
        setCurrentCameraIndex(selectedIndex);

        html5QrCode = new Html5Qrcode(scannerElementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE
          ],
          verbose: false
        });
        scannerRef.current = html5QrCode;

        const config = {
          fps: 15,
          qrbox: { width: 260, height: 160 },
          aspectRatio: 1.0
        };

        await html5QrCode.start(
          devices[selectedIndex].id,
          config,
          (decodedText, decodedResult) => {
            const now = Date.now();
            // Debounce: if same barcode within 1.2 seconds, ignore. If different barcode, allow after 400ms.
            if (
              decodedText === lastBarcodeRef.current &&
              now - lastScanTimeRef.current < 1200
            ) {
              return;
            }
            if (now - lastScanTimeRef.current < 400) {
              return;
            }

            lastScanTimeRef.current = now;
            lastBarcodeRef.current = decodedText;
            setLastScanned(decodedText);
            playBarcodeBeep();

            onScan(decodedText);

            if (!continuous) {
              stopAndClose();
            }
          },
          (errorMessage) => {
            // Frame parse errors are normal while seeking barcode
          }
        );

        // Check torch capability
        try {
          const stream = await navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } });
          const track = stream?.getVideoTracks()[0];
          const capabilities = track?.getCapabilities?.();
          if (capabilities?.torch) {
            setHasTorch(true);
          }
        } catch {
          // Ignore torch capability detection error
        }
      } catch (err) {
        console.error('Kamera başlatma hatası:', err);
        setError('Kamera açılamadı: ' + (err.message || 'Erişim reddedildi.'));
      }
    }

    startScanner();

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const stopAndClose = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (e) {
        console.warn('Scanner stop error:', e);
      }
    }
    onClose();
  };

  const toggleTorch = async () => {
    try {
      if (scannerRef.current) {
        const nextTorch = !torchOn;
        await scannerRef.current.applyVideoConstraints({
          advanced: [{ torch: nextTorch }]
        });
        setTorchOn(nextTorch);
      }
    } catch (err) {
      console.warn('Flaş hatası:', err);
    }
  };

  const switchCamera = async () => {
    if (cameras.length <= 1 || !scannerRef.current) return;
    try {
      const nextIndex = (currentCameraIndex + 1) % cameras.length;
      await scannerRef.current.stop();
      setCurrentCameraIndex(nextIndex);
      await scannerRef.current.start(
        cameras[nextIndex].id,
        { fps: 15, qrbox: { width: 260, height: 160 }, aspectRatio: 1.0 },
        (decodedText) => {
          const now = Date.now();
          if (decodedText === lastBarcodeRef.current && now - lastScanTimeRef.current < 1200) return;
          lastScanTimeRef.current = now;
          lastBarcodeRef.current = decodedText;
          setLastScanned(decodedText);
          playBarcodeBeep();
          onScan(decodedText);
        },
        () => {}
      );
    } catch (err) {
      console.error('Kamera değiştirme hatası:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 safe-bottom safe-top animate-fade-in">
      {/* Top Controls */}
      <div className="w-full flex items-center justify-between z-10 pt-2">
        <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded-full text-xs text-slate-200">
          <Scan className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="font-semibold">Barkod Tarayıcı</span>
          {continuous && <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-1.5 py-0.2 rounded font-mono">Seri Mod</span>}
        </div>

        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              onClick={toggleTorch}
              className={`p-2.5 rounded-full border transition active:scale-95 ${
                torchOn ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-800/80 text-white border-slate-700'
              }`}
              title="Flaş / Işık"
            >
              {torchOn ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              className="p-2.5 rounded-full bg-slate-800/80 text-white border border-slate-700 active:scale-95 transition"
              title="Kamera Değiştir"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={stopAndClose}
            className="p-2.5 rounded-full bg-rose-600/90 text-white border border-rose-500 shadow-lg active:scale-95 transition"
            title="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Scanner Viewport */}
      <div className="relative w-full max-w-sm aspect-square my-auto rounded-3xl overflow-hidden border-2 border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.2)] bg-black flex items-center justify-center">
        {error ? (
          <div className="p-6 text-center text-rose-400 text-sm">
            <p className="font-bold mb-2">Kamera Açılamadı</p>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        ) : (
          <div id="barcode-reader-viewport" className="w-full h-full object-cover"></div>
        )}

        {/* Scan Frame & Laser Overlay */}
        {!error && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Corner guides */}
            <div className="w-64 h-40 border-2 border-dashed border-emerald-400/80 rounded-2xl relative">
              <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-400 -mt-1 -ml-1 rounded-tl"></div>
              <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-400 -mt-1 -mr-1 rounded-tr"></div>
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-400 -mb-1 -ml-1 rounded-bl"></div>
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-400 -mb-1 -mr-1 rounded-br"></div>
              
              {/* Laser animation */}
              <div className="absolute left-0 right-0 h-0.5 bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-bounce opacity-85"></div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Info & Feedback */}
      <div className="w-full max-w-sm pb-4 flex flex-col items-center gap-2 text-center">
        {lastScanned ? (
          <div className="w-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 py-2 px-4 rounded-xl text-xs font-mono flex items-center justify-center gap-2 animate-pulse">
            <Volume2 className="w-4 h-4" />
            <span>Okundu: <b>{lastScanned}</b></span>
          </div>
        ) : (
          <p className="text-xs text-slate-400 font-medium">
            Barkodu kırmızı lazer çizgisinin ortasına getirin
          </p>
        )}

        <button
          onClick={stopAndClose}
          className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-3 rounded-xl text-sm font-semibold border border-slate-700 active:scale-98 transition"
        >
          Taramayı Bitir / Kasaya Dön
        </button>
      </div>
    </div>
  );
}
