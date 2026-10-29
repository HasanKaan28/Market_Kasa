const INTERVAL_MS = 250;
const REPEAT_MS = 1500;

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new () => BarcodeDetectorLike;

/**
 * Opens the back camera into `video` and reports each barcode it sees. Frames are read on this
 * device only: by the browser's own BarcodeDetector where there is one, by ZXing (loaded only
 * then) elsewhere. The same code is not reported again within 1,5 seconds, so a code held in
 * front of the camera counts once. The returned function stops reading and releases the camera.
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
  const reportedAt = new Map<string, number>();
  const report = (code: string) => {
    const now = Date.now();
    if (now - (reportedAt.get(code) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS) {
      return;
    }
    reportedAt.set(code, now);
    onCode(code);
  };
  try {
    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
    if (Detector) {
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
      for (const barcode of await detector.detect(video)) {
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
