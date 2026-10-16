interface PhotoGridPlan {
  outputWidth: number;
  outputHeight: number;
  scale: number;
  cells: Array<{ x: number; y: number; size: number }>;
}

interface RewardedVideoAdLike {
  load(): Promise<unknown>;
  show(): Promise<unknown>;
  destroy(): void;
  onClose(listener: (result?: { isEnded?: boolean }) => void): void;
  offClose(listener: (result?: { isEnded?: boolean }) => void): void;
  onError(listener: () => void): void;
  offError(listener: () => void): void;
}
