export function loadCanvasImage(canvas: CanvasLike, path: string): Promise<CanvasImageLike> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败，请重新选择"));
    image.src = path;
  });
}

export async function createAnalysisImage(source: SourceImage): Promise<AnalysisImage> {
  const targetWidth = 256;
  const targetHeight = Math.max(1, Math.round((source.height / source.width) * targetWidth));
  const canvas = wx.createOffscreenCanvas({ type: "2d", width: targetWidth, height: targetHeight });
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  const image = await loadCanvasImage(canvas, source.path);
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  image.onload = null;
  image.onerror = null;
  image.src = "";
  return {
    id: source.id,
    width: targetWidth,
    height: targetHeight,
    rgba: imageData.data
  };
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

  try {
    for (const segment of plan.segments) {
      const source = images[segment.imageIndex];
      if (!source) throw new Error("找不到待导出的源图片");
      const image = await loadCanvasImage(canvas, source.path);
      retainedImages.push(image);
      const drawWidth = Math.max(1, Math.round(segment.normalizedWidth * plan.scale));
      const drawHeight = Math.max(1, Math.round(segment.normalizedHeight * plan.scale));
      context.drawImage(
        image,
        segment.sourceX,
        segment.sourceY,
        segment.sourceWidth,
        segment.sourceHeight,
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
