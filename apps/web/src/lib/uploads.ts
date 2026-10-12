export interface ValidatedUpload {
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  extension: "pdf" | "jpg" | "png" | "webp";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Verify supported uploads from their bytes rather than the browser-provided
 * MIME type or filename. This rejects active formats such as SVG and files
 * renamed to look like an image or PDF.
 */
export async function validateUpload(
  file: File,
  kind: "document" | "profile-image",
): Promise<ValidatedUpload | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const pdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  const jpeg = startsWith(bytes, [0xff, 0xd8, 0xff]);
  const png = startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  const webp =
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";

  if (kind === "document" && pdf) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  if (jpeg) return { mimeType: "image/jpeg", extension: "jpg" };
  if (png) return { mimeType: "image/png", extension: "png" };
  if (kind === "profile-image" && webp) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}
