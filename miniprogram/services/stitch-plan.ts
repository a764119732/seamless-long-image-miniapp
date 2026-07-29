const MAX_OUTPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_EDGE = 32_767;
export const MIN_OUTPUT_SHORT_EDGE = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildStitchPlan(
  images: SourceImage[],
  seams: SeamDecision[],
  scaleMultiplier = 1,
  direction: StitchDirection = "vertical"
): StitchPlan {
  if (images.length < 2) throw new Error("请至少选择 2 张连续截图");
  if (seams.length !== images.length - 1) throw new Error("接缝数量与图片数量不一致");

  const baseWidth = images[0]?.width || 0;
  const baseHeight = images[0]?.height || 0;
  if (!baseWidth || !baseHeight) throw new Error("无法读取第一张图片尺寸");

  const segments: StitchSegment[] = images.map((image, index) => {
    const startRatio = index === 0 ? 0 : seams[index - 1]?.nextCropStartRatio ?? 0;
    const endRatio = index === images.length - 1 ? 1 : seams[index]?.prevCropEndRatio ?? 1;
    const safeStart = clamp(startRatio, 0, 0.98);
    const safeEnd = clamp(endRatio, 0.02, 1);
    if (safeEnd <= safeStart) throw new Error(`第 ${index + 1} 张图片的裁切范围无效，请微调相邻接缝`);
    if (direction === "horizontal") {
      const sourceX = Math.round(image.width * safeStart);
      const sourceWidth = Math.max(1, Math.round(image.width * safeEnd) - sourceX);
      return {
        imageIndex: index,
        sourceX,
        sourceY: 0,
        sourceWidth,
        sourceHeight: image.height,
        normalizedWidth: sourceWidth * (baseHeight / image.height),
        normalizedHeight: baseHeight
      };
    }
    const sourceY = Math.round(image.height * safeStart);
    const sourceHeight = Math.max(1, Math.round(image.height * safeEnd) - sourceY);
    return {
      imageIndex: index,
      sourceX: 0,
      sourceY,
      sourceWidth: image.width,
      sourceHeight,
      normalizedWidth: baseWidth,
      normalizedHeight: sourceHeight * (baseWidth / image.width)
    };
  });

  const rawWidth =
    direction === "horizontal"
      ? segments.reduce((sum, segment) => sum + segment.normalizedWidth, 0)
      : baseWidth;
  const rawHeight =
    direction === "vertical"
      ? segments.reduce((sum, segment) => sum + segment.normalizedHeight, 0)
      : baseHeight;
  const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS / Math.max(1, rawWidth * rawHeight));
  const edgeScale = MAX_OUTPUT_EDGE / Math.max(1, rawWidth, rawHeight);
  const scale = Math.min(1, pixelScale, edgeScale) * clamp(scaleMultiplier, 0.1, 1);
  const outputWidth = Math.max(1, Math.floor(rawWidth * scale));
  const outputHeight = Math.max(1, Math.floor(rawHeight * scale));

  return {
    direction,
    seams,
    segments,
    baseWidth,
    baseHeight,
    rawWidth: Math.round(rawWidth),
    rawHeight: Math.round(rawHeight),
    scale,
    outputWidth,
    outputHeight,
    estimatedPixels: outputWidth * outputHeight
  };
}
