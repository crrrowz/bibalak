import { ipc } from "./ipc";
import { mediaUrl } from "./renderCard";
import type { MediaFieldKind } from "./noteFieldGroups";

export const MEDIA_PICKER_EXTENSIONS: Record<MediaFieldKind, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico"],
  audio: ["mp3", "ogg", "wav", "m4a", "flac", "aac", "opus", "mp4", "webm", "mkv", "mov"],
  video: ["mp4", "webm", "mkv", "mov"],
};

const BARE_SRC_RE = /(<(?:img|video|audio|source)\b[^>]*?\s)src=(["'])([^"':/][^"']*)\2/gi;
const SERVED_SRC_RE =
  /(<(?:img|video|audio|source)\b[^>]*?\s)src=(["'])(?:bibalak-media:\/\/localhost\/|http:\/\/bibalak-media\.localhost\/)([^"']+)\2/gi;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const AUDIO_EXT_RE = /\.(mp3|ogg|wav|m4a|flac|aac|opus)$/i;
export const VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov)$/i;
const SOUND_TAG_RE = /\[sound:([^\]]+)\]/gi;
const IMG_SRC_RE = /<img\b[^>]*?\bsrc=(["'])([^"']+)\1[^>]*>/gi;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

const AUDIO_VIDEO_MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/quicktime": "mov",
};

function safeDecodeURIComponent(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/** Rewrite bare media filenames to servable URLs, for showing stored field HTML in the editor. */
export function toDisplayHtml(html: string, tauri: boolean): string {
  if (!tauri) return html;
  return html.replace(
    BARE_SRC_RE,
    (_, pre: string, quote: string, name: string) => `${pre}src=${quote}${mediaUrl(name)}${quote}`,
  );
}

/** Rewrite servable media URLs back to bare filenames, before persisting editor HTML. */
export function toStorageHtml(html: string): string {
  return html.replace(
    SERVED_SRC_RE,
    (_, pre: string, quote: string, encoded: string) =>
      `${pre}src=${quote}${safeDecodeURIComponent(encoded)}${quote}`,
  );
}

export function isImageFile(file: File): boolean {
  return (
    (file.type.startsWith("image/") && file.type !== "image/svg+xml") ||
    IMAGE_EXT_RE.test(file.name)
  );
}

export function isSoundMediaFile(file: File): boolean {
  return (
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    AUDIO_EXT_RE.test(file.name) ||
    VIDEO_EXT_RE.test(file.name)
  );
}

/** Collect image files from a DataTransfer (`files` or `items`). */
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
      if (item.kind === "file" && item.type.startsWith("image/") && item.type !== "image/svg+xml") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files;
}

/** Collect audio/video files from a DataTransfer (`files` or `items`). */
export function extractSoundMediaFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files: File[] = [];
  if (data.files && data.files.length > 0) {
    for (const file of Array.from(data.files)) {
      if (isSoundMediaFile(file)) files.push(file);
    }
  }
  if (files.length === 0 && data.items) {
    for (const item of Array.from(data.items)) {
      if (
        item.kind === "file" &&
        (item.type.startsWith("audio/") || item.type.startsWith("video/"))
      ) {
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
  if (!tauri) {
    throw new Error("Media uploads require the desktop app.");
  }
  const ext = MIME_TO_EXT[file.type] ?? "png";
  const filename = file.name.trim() || `pasted-${Date.now()}.${ext}`;
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer();
  const stored = await ipc.saveMedia(new Uint8Array(buffer), filename);
  return { src: mediaUrl(stored), alt: stored };
}

/** Save a dropped/pasted audio or video File to MediaStore and return its stored filename. */
export async function saveSoundMediaFile(file: File, tauri: boolean): Promise<string> {
  if (!tauri) {
    throw new Error("Media uploads require the desktop app.");
  }
  const ext = AUDIO_VIDEO_MIME_TO_EXT[file.type] ?? "mp3";
  const filename = file.name.trim() || `media-${Date.now()}.${ext}`;
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer();
  return ipc.saveMedia(new Uint8Array(buffer), filename);
}

/** Return unique `[sound:name]` media filenames found in `html`. */
export function extractSoundRefs(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  SOUND_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SOUND_TAG_RE.exec(html)) !== null) {
    const name = m[1]?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Return unique image filenames referenced by `<img>` tags in `html`. */
export function extractImageRefs(html: string): Array<{ rawSrc: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ rawSrc: string; name: string }> = [];
  IMG_SRC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_SRC_RE.exec(html)) !== null) {
    const rawSrc = m[2] ?? "";
    if (
      !rawSrc ||
      (/^https?:/i.test(rawSrc) && !rawSrc.startsWith("http://bibalak-media.localhost/"))
    ) {
      continue;
    }
    const stripped = rawSrc
      .replace(/^bibalak-media:\/\/localhost\//i, "")
      .replace(/^http:\/\/bibalak-media\.localhost\//i, "");
    const name = safeDecodeURIComponent(stripped);
    if (name && !seen.has(rawSrc)) {
      seen.add(rawSrc);
      out.push({ rawSrc, name });
    }
  }
  return out;
}

/** Append an `<img>` or `[sound:...]` tag to existing field HTML cleanly. */
export function appendMediaTagToHtml(current: string, tag: string): string {
  const trimmed = current.trim();
  if (!trimmed || trimmed === "<p></p>" || trimmed === "<p><br></p>") return `<p>${tag}</p>`;
  return `${current}${current.endsWith(" ") ? "" : " "}${tag}`;
}

/** Inspect field HTML to determine embedded media references and whether non-media text exists. */
export function analyzeFieldMediaContent(html: string): {
  soundRefs: string[];
  imageRefs: Array<{ rawSrc: string; name: string }>;
  hasText: boolean;
  pureKind: MediaFieldKind | null;
} {
  const soundRefs = extractSoundRefs(html);
  const imageRefs = extractImageRefs(html);
  const stripped = html
    .replace(/\[sound:[^\]]+\]/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
  const hasText = stripped.length > 0;
  let pureKind: MediaFieldKind | null = null;
  if (!hasText) {
    if (imageRefs.length > 0 && soundRefs.length === 0) {
      pureKind = "image";
    } else if (soundRefs.length > 0 && imageRefs.length === 0) {
      pureKind = soundRefs.every((name) => VIDEO_EXT_RE.test(name)) ? "video" : "audio";
    }
  }
  return { soundRefs, imageRefs, hasText, pureKind };
}

/** Replace `[sound:oldName]` or `<img src="rawSrc">` in stored field HTML. */
export function replaceSoundRefInHtml(html: string, oldName: string, nextName: string): string {
  return html.replace(`[sound:${oldName}]`, `[sound:${nextName}]`);
}

/** Remove a `[sound:name]` marker from field HTML. */
export function removeSoundRefFromHtml(html: string, name: string): string {
  return html.replace(`[sound:${name}]`, "").trim();
}

/** Replace `<img src="rawSrc">` with a newly saved image filename. */
export function replaceImageRefInHtml(html: string, rawSrc: string, savedName: string): string {
  const escaped = rawSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`(<img\\b[^>]*\\bsrc=(["']))${escaped}\\2`, "gi"),
    `$1${savedName}$2`,
  );
}

/** Remove an `<img src="rawSrc">` element from field HTML. */
export function removeImageRefFromHtml(html: string, rawSrc: string): string {
  const escaped = rawSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`<img\\b[^>]*\\bsrc=(["'])${escaped}\\1[^>]*>`, "gi"), "").trim();
}
