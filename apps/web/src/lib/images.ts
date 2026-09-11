/**
 * Downscale before upload. Phone photos arrive at 3–12 MB; a 1600px WebP of a
 * screenshot is a tenth of that and loses nothing a bug report needs.
 */
export async function shrinkImage(
  file: File,
  maxEdge = 1600,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  if (scale === 1 && file.type === "image/webp") {
    return { blob: file, width, height };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85),
  );
  // Very old browsers cannot encode WebP; PNG is the fallback, never a failure.
  return {
    blob:
      blob ??
      (await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      )),
    width,
    height,
  };
}
