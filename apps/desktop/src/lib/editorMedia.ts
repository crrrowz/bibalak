import { ipc } from "./ipc";
import { mediaUrl } from "./renderCard";

const BARE_SRC_RE = /(<img\b[^>]*?\s)src="([^":/][^"]*)"/gi;
const SERVED_SRC_RE =
  /(<img\b[^>]*?\s)src="(?:bibalak-media:\/\/localhost\/|http:\/\/bibalak-media\.localhost\/)([^"]+)"/gi;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** Rewrite bare media filenames to servable URLs, for showing stored field HTML in the editor. */
export function toDisplayHtml(html: string, tauri: boolean): string {
  if (!tauri) return html;
  return html.replace(
    BARE_SRC_RE,
    (_, pre: string, name: string) => `${pre}src="${mediaUrl(name)}"`,
  );
}

/** Rewrite servable media URLs back to bare filenames, before persisting editor HTML. */
export function toStorageHtml(html: string): string {
  return html.replace(
    SERVED_SRC_RE,
    (_, pre: string, encoded: string) => `${pre}src="${decodeURIComponent(encoded)}"`,
  );
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT_RE.test(file.name);
}

/** Collect image files from a ClipboardEvent's DataTransfer (`files` or `items`). */
export function extractImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files: File[] = [];
  if (data.files && data.files.length > 0) {
    for (const file of Array.from(data.files)) {
      if (isImageFile(file)) files.push(file);
    }
  }
  if (files.length === 0 && data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files;
}

/** Save a dropped/pasted image File to MediaStore (deduped) and return `{ src, alt }`. */
export async function saveImageFile(
  file: File,
  tauri: boolean,
): Promise<{ src: string; alt: string }> {
  const ext = MIME_TO_EXT[file.type] ?? "png";
  const filename = file.name.trim() || `pasted-${Date.now()}.${ext}`;
  if (!tauri) {
    return { src: URL.createObjectURL(file), alt: filename };
  }
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer();
  const stored = await ipc.saveMedia(new Uint8Array(buffer), filename);
  return { src: mediaUrl(stored), alt: stored };
}
