import type { SpendHistoryEntryDto } from "@bibalak/ipc-types";
import { t } from "@/lib/i18n";
import { en, type LocaleKey } from "@/locales/en";

/** Resolve a localized display name for a shop/game item key, falling back to `fallback` or the raw key. */
export function gameItemTitle(itemKey: string, fallback?: string): string {
  const key = `game.item.${itemKey}`;
  if (Object.prototype.hasOwnProperty.call(en, key)) {
    return t(key as LocaleKey);
  }
  return fallback ?? itemKey;
}

/** Resolve the user-facing label for a spend history entry (custom rewards keep their user title). */
export function spendEntryLabel(
  entry: Pick<SpendHistoryEntryDto, "kind" | "ref_key" | "label">,
): string {
  if (entry.kind === "custom_reward") {
    return entry.label;
  }
  return gameItemTitle(entry.ref_key, entry.label);
}
