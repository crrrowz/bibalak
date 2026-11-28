import type { MediaKind } from "@bibalak/ipc-types";
import { formatNumber, t } from "@/lib/i18n";

export const MEDIA_PAGE_SIZE = 48;

export function mediaKindLabel(kind: MediaKind): string {
  if (kind === "image") return t("media.kind.image");
  if (kind === "audio") return t("media.kind.audio");
  if (kind === "video") return t("media.kind.video");
  return t("media.kind.other");
}

export function browseQueryForMedia(filename: string): string {
  const escaped = filename.replace(/([\\*_"])/g, "\\$1");
  return `"${escaped}"`;
}

/** Format byte counts cleanly in active app locale digits (`0 B`, `2 KB`, `1.5 MB`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${formatNumber(value, { maximumFractionDigits: 1 })} ${units[unitIdx]}`;
}

/** Convert a media filename to its bibalak-media:// URL. */
export function mediaUrl(filename: string): string {
  const encoded = encodeURIComponent(filename);
  // On Windows Tauri uses http://scheme.localhost/, elsewhere scheme://localhost/
  return navigator.userAgent.includes("Windows")
    ? `http://bibalak-media.localhost/${encoded}`
    : `bibalak-media://localhost/${encoded}`;
}
