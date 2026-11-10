const INTERVAL_MS = 250;
// How long a code must be out of view before it counts again.
const GONE_MS = 1000;

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = {
  new (): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
};

/**
 * Opens the back camera into `video` and reports each barcode it sees. Frames are read on this
 * device only: by the browser's own BarcodeDetector where there is one, by ZXing (loaded only
 * then) elsewhere. A code is reported as it comes into view: one held in front of the camera
 * counts once, and counts again only after it was out of view for a second. The returned
 * function stops reading and releases the camera.
 */
export async function startCameraScan(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const lastSeen = new Map<string, number>();
  const report = (code: string) => {
    const now = Date.now();
    const seen = lastSeen.get(code);
    lastSeen.set(code, now);
    if (seen === undefined || now - seen >= GONE_MS) {
      onCode(code);
    }
  };
  try {
    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
    // Some Android builds have the detector but no formats it can read; ZXing reads there.
    if (Detector && ((await Detector.getSupportedFormats?.()) ?? ['any']).length > 0) {
      return await readWithDetector(video, stream, new Detector(), report, release);
    }
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const controls = await new BrowserMultiFormatReader().decodeFromStream(
      stream,
      video,
      (result) => {
        if (result) {
          report(result.getText());
        }
      },
    );
    return () => {
      controls.stop();
      release();
    };
  } catch (error) {
    release();
    throw error;
  }
}

async function readWithDetector(
  video: HTMLVideoElement,
  stream: MediaStream,
  detector: BarcodeDetectorLike,
  report: (code: string) => void,
  release: () => void,
): Promise<() => void> {
  video.srcObject = stream;
  await video.play();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const found = await detector.detect(video);
      // A read that finishes after the camera was stopped is not reported.
      for (const barcode of stopped ? [] : found) {
        report(barcode.rawValue);
      }
    } catch {
      // A frame that is not ready yet; the next one is read in a moment.
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), INTERVAL_MS);
    }
  };
  timer = setTimeout(() => void tick(), INTERVAL_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
    video.srcObject = null;
    release();
  };
}
