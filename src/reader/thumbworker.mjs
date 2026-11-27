// 缩略图（缩略图栏、全屏缩略图）的解码与缩小，在 Worker 里进行，不占主线程（由 view.mjs 调用）。
// 收到 {id, file, maxW, maxH}：解码原图，按宽 ≤ maxW、高 ≤ maxH 等比缩小，回传 {id, bitmap, blob, w, h}
// （bitmap 为显示用的小图，blob 为存进会话缓存的 WebP，w / h 为原图尺寸）；解不了的（如 SVG）回传 {id, error}，由主线程改用 <img> 解码。
self.onmessage = async ({ data: { id, file, maxW, maxH } }) => {
  try {
    const full = await createImageBitmap(file),
      w = full.width,
      h = full.height,
      scale = Math.min(1, maxW / w, maxH / h),
      canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    canvas.getContext('2d').drawImage(full, 0, 0, canvas.width, canvas.height);
    full.close();
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }).catch(() => null),
      bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap, blob, w, h }, [bitmap]);
  } catch (e) {
    self.postMessage({ id, error: e?.name || 'Error' });
  }
};
