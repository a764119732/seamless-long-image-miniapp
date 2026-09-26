function decodeCanvasImage(canvas: CanvasLike, path: string): Promise<CanvasImageLike> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => {
      releaseCanvasImages([image]);
      reject(new Error("图片解码失败，请选择 JPG/PNG 截图或减少图片数量后重试"));
    };
    image.src = path;
  });
}

export async function loadCanvasImage(canvas: CanvasLike, path: string): Promise<CanvasImageLike> {
  try {
    return await decodeCanvasImage(canvas, path);
  } catch (error) {
    // 原图优先；解码失败才使用微信本机接口生成较小的兼容图片，最多重试一次。
    if (typeof wx.compressImage !== "function") throw error;
    const compatiblePath = await new Promise<string>((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: (info: { width: number; height: number }) => {
          if (!Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0) {
            reject(error);
            return;
          }
          const scale = Math.min(1, 2048 / Math.max(info.width, info.height));
          wx.compressImage({
            src: path,
            quality: 100,
            compressedWidth: Math.max(1, Math.round(info.width * scale)),
            compressedHeight: Math.max(1, Math.round(info.height * scale)),
            success: (result: { tempFilePath: string }) => result.tempFilePath ? resolve(result.tempFilePath) : reject(error),
            fail: () => reject(error)
          });
        },
        fail: () => reject(error)
      });
    });
    return decodeCanvasImage(canvas, compatiblePath);
  }
}

export async function createAnalysisImage(source: SourceImage): Promise<AnalysisImage> {
  const targetWidth = 256;
  const targetHeight = Math.max(1, Math.round((source.height / source.width) * targetWidth));
  const canvas = wx.createOffscreenCanvas({ type: "2d", width: targetWidth, height: targetHeight });
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  let image: CanvasImageLike | undefined;
  try {
    image = await loadCanvasImage(canvas, source.path);
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return {
      id: source.id,
      width: targetWidth,
      height: targetHeight,
      rgba: context.getImageData(0, 0, targetWidth, targetHeight).data
    };
  } finally {
    if (image) releaseCanvasImages([image]);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function releaseCanvasImages(images: CanvasImageLike[]): void {
  for (const image of images) {
    image.onload = null;
    image.onerror = null;
    image.src = "";
  }
}

export async function renderPlanToCanvas(
  canvas: CanvasLike,
  images: SourceImage[],
  plan: StitchPlan
): Promise<CanvasImageLike[]> {
  canvas.width = plan.outputWidth;
  canvas.height = plan.outputHeight;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, plan.outputWidth, plan.outputHeight);
  const retainedImages: CanvasImageLike[] = [];
  let outputX = 0;
  let outputY = 0;
  let normalizedOffset = 0;

  try {
    for (const segment of plan.segments) {
      const source = images[segment.imageIndex];
      if (!source) throw new Error("找不到待导出的源图片");
      const image = await loadCanvasImage(canvas, source.path);
      retainedImages.push(image);
      const sourceScaleX = (image.width || source.width) / source.width;
      const sourceScaleY = (image.height || source.height) / source.height;
      normalizedOffset += plan.direction === "horizontal" ? segment.normalizedWidth : segment.normalizedHeight;
      const end = Math.min(
        plan.direction === "horizontal" ? plan.outputWidth : plan.outputHeight,
        Math.round(normalizedOffset * plan.scale)
      );
      const drawWidth = plan.direction === "horizontal" ? end - outputX : plan.outputWidth;
      const drawHeight = plan.direction === "vertical" ? end - outputY : plan.outputHeight;
      if (drawWidth <= 0 || drawHeight <= 0) continue;
      context.drawImage(
        image,
        segment.sourceX * sourceScaleX,
        segment.sourceY * sourceScaleY,
        segment.sourceWidth * sourceScaleX,
        segment.sourceHeight * sourceScaleY,
        outputX,
        outputY,
        drawWidth,
        drawHeight
      );
      if (plan.direction === "horizontal") outputX += drawWidth;
      else outputY += drawHeight;
    }
    return retainedImages;
  } catch (error) {
    releaseCanvasImages(retainedImages);
    throw error;
  }
}

export function canvasToPng(canvas: CanvasLike, width: number, height: number, component: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    // iOS 真机的 Canvas 2D 绘制可能在下一帧才提交到 GPU。立即导出会得到
    // 尚未完成的黑色区域，因此保留源图片并等待一帧后再读取画布。
    setTimeout(() => {
      wx.canvasToTempFilePath(
        {
          canvas,
          fileType: "png",
          destWidth: width,
          destHeight: height,
          success: (result: { tempFilePath: string }) => resolve(result.tempFilePath),
          fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg || "长图导出失败"))
        },
        component
      );
    }, 32);
  });
}
