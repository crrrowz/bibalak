import { en, type LocaleKey } from "@/locales/en";
import type { Style } from "@/stores/style";

export type PresentationStyleOrGame = Style | "game";

/**
 * Resolve a style-specific locale key (`<baseKey>.<style>`), falling back to
 * `<baseKey>` when the style variant is absent (preserving shipped Default keys).
 */
export function styleKey(baseKey: string, style: PresentationStyleOrGame): LocaleKey {
  const variant = `${baseKey}.${style}`;
  if (Object.prototype.hasOwnProperty.call(en, variant)) {
    return variant as LocaleKey;
  }
  if (Object.prototype.hasOwnProperty.call(en, baseKey)) {
    return baseKey as LocaleKey;
  }
  const fallbackDefault = `${baseKey}.default`;
  if (Object.prototype.hasOwnProperty.call(en, fallbackDefault)) {
    return fallbackDefault as LocaleKey;
  }
  return baseKey as LocaleKey;
}
