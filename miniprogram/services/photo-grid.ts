import { loadCanvasImage, releaseCanvasImages } from "./canvas";
import { validateSourceImage } from "../lib/source-validation";

export function buildPhotoGridPlan(images: SourceImage[], scale = 1): PhotoGridPlan {
  if (images.length < 2 || images.length > 9) throw new Error("宫格拼图请选择 2–9 张图片");
  images.forEach(image => validateSourceImage(image));
  const columns = images.length === 2 || images.length === 4 ? 2 : 3;
  const rows = Math.ceil(images.length / columns);
  const gap = 24;
  const size = Math.floor((1080 - gap * (columns + 1)) / columns);
  const safeScale = Math.min(1, Math.max(0.1, scale));
  return {
    outputWidth: Math.floor(1080 * safeScale),
    outputHeight: Math.floor((rows * size + gap * (rows + 1)) * safeScale),
    scale: safeScale,
    cells: images.map((_, imageIndex) => ({
      imageIndex, x: gap + (imageIndex % columns) * (size + gap),
      y: gap + Math.floor(imageIndex / columns) * (size + gap), size
    }))
  };
}

export async function renderPhotoGridToCanvas(
  canvas: CanvasLike, images: SourceImage[], plan: PhotoGridPlan
): Promise<CanvasImageLike[]> {
  canvas.width = plan.outputWidth;
  canvas.height = plan.outputHeight;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const retained: CanvasImageLike[] = [];
  try {
    for (const cell of plan.cells) {
      const source = images[cell.imageIndex];
      if (!source) throw new Error("找不到待导出的源图片");
      const image = await loadCanvasImage(canvas, source.path);
      retained.push(image);
      const width = image.width || source.width;
      const height = image.height || source.height;
      const fit = Math.min(cell.size / width, cell.size / height);
      context.drawImage(image, 0, 0, width, height,
        (cell.x + (cell.size - width * fit) / 2) * plan.scale,
        (cell.y + (cell.size - height * fit) / 2) * plan.scale,
        width * fit * plan.scale, height * fit * plan.scale);
    }
    return retained;
  } catch (error) {
    releaseCanvasImages(retained);
    throw error;
  }
}
