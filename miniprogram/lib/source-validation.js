"use strict";

function validateSourceImage(info, direction = "vertical") {
  if (!info || !Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0) {
    throw new Error("无法读取图片尺寸，请重新选择");
  }
  if (direction === "horizontal" && info.width <= info.height) {
    throw new Error("横向拼接请选择宽度大于高度的横向截图");
  }
  if (direction !== "horizontal" && info.width >= info.height) {
    throw new Error("竖向拼接请选择高度大于宽度的竖向截图");
  }
  return true;
}

module.exports = { validateSourceImage };
