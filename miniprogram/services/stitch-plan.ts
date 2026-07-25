const MAX_OUTPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_HEIGHT = 32_767;
export const MIN_OUTPUT_WIDTH = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildStitchPlan(images: SourceImage[], seams: SeamDecision[], scaleMultiplier = 1): StitchPlan {
  if (images.length < 2) throw new Error("请至少选择 2 张连续截图");
  if (seams.length !== images.length - 1) throw new Error("接缝数量与图片数量不一致");

  const baseWidth = images[0]?.width || 0;
  if (!baseWidth) throw new Error("无法读取第一张图片尺寸");

  const segments: StitchSegment[] = images.map((image, index) => {
    const startRatio = index === 0 ? 0 : seams[index - 1]?.nextCropStartRatio ?? 0;
    const endRatio = index === images.length - 1 ? 1 : seams[index]?.prevCropEndRatio ?? 1;
    const safeStart = clamp(startRatio, 0, 0.98);
    const safeEnd = clamp(endRatio, 0.02, 1);
    if (safeEnd <= safeStart) throw new Error(`第 ${index + 1} 张图片的裁切范围无效，请微调相邻接缝`);
    const sourceY = Math.round(image.height * safeStart);
    const sourceHeight = Math.max(1, Math.round(image.height * safeEnd) - sourceY);
    return {
      imageIndex: index,
      sourceY,
      sourceHeight,
      normalizedHeight: sourceHeight * (baseWidth / image.width)
    };
  });

  const rawHeight = segments.reduce((sum, segment) => sum + segment.normalizedHeight, 0);
  const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS / Math.max(1, baseWidth * rawHeight));
  const heightScale = MAX_OUTPUT_HEIGHT / Math.max(1, rawHeight);
  const scale = Math.min(1, pixelScale, heightScale) * clamp(scaleMultiplier, 0.1, 1);
  const outputWidth = Math.max(1, Math.floor(baseWidth * scale));
  const outputHeight = Math.max(1, Math.floor(rawHeight * scale));

  return {
    seams,
    segments,
    baseWidth,
    rawHeight: Math.round(rawHeight),
    scale,
    outputWidth,
    outputHeight,
    estimatedPixels: outputWidth * outputHeight
  };
}
