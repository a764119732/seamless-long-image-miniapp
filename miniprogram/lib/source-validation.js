"use strict";

function validatePortraitImage(info) {
  if (!info || !Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0) {
    throw new Error("无法读取图片尺寸，请重新选择");
  }
  if (info.width >= info.height) {
    throw new Error("首版只支持竖向截图，请先在系统相册中统一图片方向");
  }
  return true;
}

module.exports = { validatePortraitImage };
