"use strict";

function validateSourceImage(info) {
  if (!info || !Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0) {
    throw new Error("无法读取图片尺寸，请重新选择");
  }
  return true;
}

module.exports = { validateSourceImage };
