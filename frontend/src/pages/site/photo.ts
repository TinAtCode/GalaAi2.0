// Fotos vor dem Hochladen verkleinern: Handyfotos haben oft 4–12 MB, auf der
// Baustelle ist das Netz langsam. Längste Seite höchstens 1920 px, JPEG 80 %.
// Metadaten (auch GPS) fallen dabei weg. Kann der Browser das Bild nicht
// lesen (z.B. HEIC außerhalb von Safari), geht das Original hoch.
export const MAX_SIDE = 1920;

export function targetSize(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function compressPhoto(file: File): Promise<{ blob: Blob; fileName: string }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob || blob.size >= file.size) return { blob: file, fileName: file.name || 'foto.jpg' };
    return { blob, fileName: `${(file.name || 'foto').replace(/\.[^.]+$/, '')}.jpg` };
  } catch {
    return { blob: file, fileName: file.name || 'foto.jpg' };
  }
}
