import { loadCanvasImage, releaseCanvasImages, canvasToPng } from "./canvas";
import { validateSourceImage } from "../lib/source-validation";

export function buildPhotoGridPlan(images: SourceImage[], scale = 1): PhotoGridPlan {
  if (images.length !== 1) throw new Error("九宫格切图请选择 1 张图片");
  const source = images[0]!;
  validateSourceImage(source);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("切图尺寸无效，请重试");
  const baseSize = Math.max(3, Math.ceil(Math.min(3240, Math.max(source.width, source.height)) / 3) * 3);
  const size = Math.max(1, Math.floor(baseSize * Math.min(1, scale) / 3));
  return {
    outputWidth: size * 3,
    outputHeight: size * 3,
    scale: size * 3 / baseSize,
    cells: Array.from({ length: 9 }, (_, index) => ({
      x: (index % 3) * size, y: Math.floor(index / 3) * size, size
    }))
  };
}

function drawPhotoGrid(
  canvas: CanvasLike, image: CanvasImageLike, source: SourceImage, plan: PhotoGridPlan,
  cell?: PhotoGridPlan["cells"][number]
): void {
  canvas.width = cell?.size ?? plan.outputWidth;
  canvas.height = cell?.size ?? plan.outputHeight;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const width = image.width || source.width;
  const height = image.height || source.height;
  const fit = plan.outputWidth / Math.max(width, height);
  context.drawImage(image, 0, 0, width, height,
    (plan.outputWidth - width * fit) / 2 - (cell?.x ?? 0),
    (plan.outputHeight - height * fit) / 2 - (cell?.y ?? 0), width * fit, height * fit);
}

export async function renderPhotoGridToCanvas(
  canvas: CanvasLike, images: SourceImage[], plan: PhotoGridPlan
): Promise<CanvasImageLike[]> {
  const source = images[0];
  if (!source) throw new Error("找不到待切分的图片");
  const image = await loadCanvasImage(canvas, source.path);
  try {
    drawPhotoGrid(canvas, image, source, plan);
    return [image];
  } catch (error) {
    releaseCanvasImages([image]);
    throw error;
  }
}

export async function exportPhotoGridTiles(
  canvas: CanvasLike, images: SourceImage[], plan: PhotoGridPlan, component: unknown,
  isCurrent: () => boolean
): Promise<string[]> {
  const source = images[0];
  if (!source) throw new Error("找不到待切分的图片");
  const image = await loadCanvasImage(canvas, source.path);
  const paths: string[] = [];
  try {
    for (const cell of plan.cells) {
      if (!isCurrent()) throw new Error("用户取消切图");
      drawPhotoGrid(canvas, image, source, plan, cell);
      paths.push(await canvasToPng(canvas, cell.size, cell.size, component));
    }
    if (!isCurrent()) throw new Error("用户取消切图");
    return paths;
  } catch (error) {
    for (const filePath of paths) wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
    throw error;
  } finally {
    releaseCanvasImages([image]);
    canvas.width = 1;
    canvas.height = 1;
  }
}
