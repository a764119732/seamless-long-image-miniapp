declare function App<T extends Record<string, unknown>>(options: T): void;
declare function Page<T extends Record<string, unknown>>(options: T): void;

declare const wx: {
  chooseMedia(options: Record<string, unknown>): void;
  getPrivacySetting(options: Record<string, unknown>): void;
  getImageInfo(options: Record<string, unknown>): void;
  createOffscreenCanvas(options: Record<string, unknown>): CanvasLike;
  createWorker(path: string): WorkerLike;
  canvasToTempFilePath(options: Record<string, unknown>, component?: unknown): void;
  saveImageToPhotosAlbum(options: Record<string, unknown>): void;
  showShareImageMenu(options: Record<string, unknown>): void;
  openSetting(options?: Record<string, unknown>): void;
  openPrivacyContract(options: Record<string, unknown>): void;
  showToast(options: Record<string, unknown>): void;
  showModal(options: Record<string, unknown>): void;
  getWindowInfo(): { safeArea?: { top: number }; statusBarHeight?: number };
  canIUse(schema: string): boolean;
};

interface WorkerLike {
  postMessage(message: unknown): void;
  onMessage(callback: (message: WorkerResponse) => void): void;
  onError(callback: (error: { message?: string }) => void): void;
  terminate(): void;
}

interface CanvasImageLike {
  src: string;
  width: number;
  height: number;
  onload: (() => void) | null;
  onerror: ((error?: unknown) => void) | null;
}

interface CanvasContextLike {
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: CanvasImageLike, ...args: number[]): void;
  getImageData(x: number, y: number, width: number, height: number): ImageData;
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): CanvasContextLike;
  createImage(): CanvasImageLike;
}

type AppState = "select" | "analyzing" | "preview" | "manual" | "exporting" | "complete" | "error";

interface SourceImage {
  id: string;
  path: string;
  width: number;
  height: number;
  orientation: string;
  order: number;
  thumbPath: string;
}

interface AnalysisImage {
  id: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

interface SeamDecision {
  pairIndex: number;
  mode: "auto" | "manual";
  prevCropEndRatio: number;
  nextCropStartRatio: number;
  fixedTopRatio: number;
  fixedBottomRatio: number;
  confidence: number;
  margin: number;
  textureCoverage: number;
  overlapRatio: number;
  orderHint?: boolean;
}

interface StitchSegment {
  imageIndex: number;
  sourceY: number;
  sourceHeight: number;
  normalizedHeight: number;
}

interface StitchPlan {
  seams: SeamDecision[];
  segments: StitchSegment[];
  baseWidth: number;
  rawHeight: number;
  scale: number;
  outputWidth: number;
  outputHeight: number;
  estimatedPixels: number;
}

type WorkerRequest =
  | { type: "ANALYZE_PAIR"; jobId: string; pairIndex: number; left: AnalysisImage; right: AnalysisImage }
  | { type: "CANCEL"; jobId: string };

type WorkerResponse =
  | { type: "PROGRESS"; jobId: string; pairIndex: number; progress: number }
  | { type: "PAIR_RESULT"; jobId: string; pairIndex: number; result: SeamDecision }
  | { type: "ERROR"; jobId: string; pairIndex?: number; message: string };
