import { hasTranslationKey } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { Style } from "@/stores/style";

export type PresentationStyleOrGame = Style | "game";

/**
 * Resolve a style-specific locale key (`<baseKey>.<style>`), falling back to
 * `<baseKey>` when the style variant is absent (preserving shipped Default keys).
 */
export function styleKey(baseKey: string, style: PresentationStyleOrGame): LocaleKey {
  const variant = `${baseKey}.${style}`;
  if (hasTranslationKey(variant)) {
    return variant as LocaleKey;
  }
  if (hasTranslationKey(baseKey)) {
    return baseKey as LocaleKey;
  }
  const fallbackDefault = `${baseKey}.default`;
  if (hasTranslationKey(fallbackDefault)) {
    return fallbackDefault as LocaleKey;
  }
  return baseKey as LocaleKey;
}
