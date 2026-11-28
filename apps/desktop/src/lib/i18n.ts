/**
 * App localisation (English + Arabic), no runtime dependency.
 *
 *   import { t, tn } from "@/lib/i18n";
 *   t("settings.title")                     // plain string
 *   t("app.version", { version: "1.0.0" })  // {{var}} interpolation
 *   tn("common.cards", count)               // plural via Intl.PluralRules
 *
 * The active locale lives in a small zustand store (persisted to
 * localStorage) and is mirrored onto <html lang dir>, so CSS logical
 * properties flip the whole layout for Arabic. The app re-mounts its route
 * tree when the locale changes (see App.tsx), so plain `t()` calls in render
 * code pick up the new language without per-component subscriptions.
 *
 * To add a locale: copy `locales/ar.ts`, translate, register it in LOCALES
 * and DIRECTION, and add it to the language picker in Settings.
 */
import { create } from "zustand";
import type { LocaleKey } from "@/locales/en";

export type Locale = "en" | "ar";

type LocaleTable = Record<LocaleKey, string>;

const CACHE_SLOT = "__BIBALAK_LOCALE_CACHE__";
const g = globalThis as Record<string, unknown>;
const LOCALES = (g[CACHE_SLOT] ?? (g[CACHE_SLOT] = {})) as Partial<Record<Locale, LocaleTable>>;
const pendingLoads: Partial<Record<Locale, Promise<void>>> = {};

export function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (LOCALES[locale]) return Promise.resolve();
  if (pendingLoads[locale]) return pendingLoads[locale]!;
  const p = (
    locale === "ar"
      ? import("@/locales/ar").then((m) => {
          LOCALES.ar = m.ar;
        })
      : import("@/locales/en").then((m) => {
          LOCALES.en = m.en;
        })
  ).finally(() => {
    delete pendingLoads[locale];
  });
  pendingLoads[locale] = p;
  return p;
}

export function hasTranslationKey(key: string): boolean {
  const active = LOCALES[getLocale()] ?? LOCALES.en ?? LOCALES.ar;
  return active ? Object.prototype.hasOwnProperty.call(active, key) : false;
}
const DIRECTION: Record<Locale, "ltr" | "rtl"> = { en: "ltr", ar: "rtl" };
/** Latin digits in Arabic UI (`-u-nu-latn`), as most Iraqi apps use. */
const INTL_TAG: Record<Locale, string> = { en: "en", ar: "ar-u-nu-latn" };
const STORAGE_KEY = "keepsake-locale";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" };

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "ar";
}

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // storage unavailable: fall through to the system language
  }
  if (typeof navigator !== "undefined") {
    const langs =
      Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [];
    if (langs.some((lang) => lang.toLowerCase().startsWith("ar"))) {
      return "ar";
    }
  }
  return "en";
}

function applyToDocument(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = DIRECTION[locale];
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const initial = initialLocale();
applyToDocument(initial);

export const useLocale = create<LocaleState>((set) => ({
  locale: initial,
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // not persisted; still switch for this session
    }
    if (LOCALES[locale]) {
      applyToDocument(locale);
      set({ locale });
      return;
    }
    void ensureLocaleLoaded(locale).then(() => {
      applyToDocument(locale);
      set({ locale });
    });
  },
}));

export function setLocale(locale: Locale) {
  useLocale.getState().setLocale(locale);
}

export function getLocale(): Locale {
  return useLocale.getState().locale;
}

export function textDirection(): "ltr" | "rtl" {
  return DIRECTION[getLocale()];
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Translate a key; falls back to English, then to the key itself. */
export function t(
  key: LocaleKey,
  vars?: Record<string, string | number>,
  locale: Locale = getLocale(),
): string {
  return interpolate(LOCALES[locale]?.[key] ?? LOCALES.en?.[key] ?? key, vars);
}

/** Keys that have plural variants: `<base>_one`, `<base>_other`, … */
export type PluralKey = LocaleKey extends infer K
  ? K extends `${infer Base}_other`
    ? Base
    : never
  : never;

const pluralRules = new Map<Locale, Intl.PluralRules>();

/**
 * Plural-aware translation. Looks up `<base>_<category>` for the count's
 * CLDR category (Arabic has zero/one/two/few/many/other), falling back to
 * `<base>_other`. `{{count}}` is available in the string.
 */
export function tn(
  base: PluralKey,
  count: number,
  vars?: Record<string, string | number>,
  locale: Locale = getLocale(),
): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_TAG[locale]);
    pluralRules.set(locale, rules);
  }
  const table = (LOCALES[locale] ?? LOCALES.en) as Record<string, string> | undefined;
  const str = table?.[`${base}_${rules.select(count)}`] ?? table?.[`${base}_other`] ?? base;
  return interpolate(str, { count: formatNumber(count, undefined, locale), ...vars });
}

export function formatNumber(
  n: number,
  options?: Intl.NumberFormatOptions,
  locale: Locale = getLocale(),
): string {
  return new Intl.NumberFormat(INTL_TAG[locale], options).format(n);
}

export function formatDate(
  date: Date | number,
  options?: Intl.DateTimeFormatOptions,
  locale: Locale = getLocale(),
): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], options).format(date);
}
