import { formatNumber, getLocale, t, tn, type Locale } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { Style } from "@/stores/style";

export const SCHOLAR_TITLE_SEEN_KEY = "keepsake-scholar-title-seen";
export const SCHOLAR_NAME_KEY = "keepsake-scholar-name";
export const SCHOLAR_NAME_MAX_LENGTH = 60;

export const SCHOLAR_TITLE_TIERS: ReadonlyArray<{
  index: number;
  minLevel: number;
  key: LocaleKey;
}> = [
  { index: 0, minLevel: 1, key: "progress.title.student" },
  { index: 1, minLevel: 5, key: "progress.title.researcher" },
  { index: 2, minLevel: 10, key: "progress.title.lecturer" },
  { index: 3, minLevel: 20, key: "progress.title.assistantProfessor" },
  { index: 4, minLevel: 35, key: "progress.title.professor" },
];

const SCHOLAR_TITLES: ReadonlyArray<{ minLevel: number; key: LocaleKey }> = [
  ...SCHOLAR_TITLE_TIERS,
].reverse();

/** Map an engine level (1+) to its Scholar academic title locale key. */
export function scholarTitle(level: number): LocaleKey {
  for (const entry of SCHOLAR_TITLES) {
    if (level >= entry.minLevel) return entry.key;
  }
  return "progress.title.student";
}

/** Map an engine level (1+) to its 0-based Scholar title index (0..4). */
export function scholarTitleIndex(level: number): number {
  for (let i = SCHOLAR_TITLE_TIERS.length - 1; i >= 0; i -= 1) {
    if (level >= SCHOLAR_TITLE_TIERS[i].minLevel) return SCHOLAR_TITLE_TIERS[i].index;
  }
  return 0;
}

/** Map a 0-based Scholar title index back to its locale key. */
export function scholarTitleByIndex(index: number): LocaleKey {
  return SCHOLAR_TITLE_TIERS[index]?.key ?? "progress.title.student";
}

/** Trim and cap a certificate name to at most 60 characters. */
export function normalizeCertificateName(raw: string): string {
  return raw.trim().slice(0, SCHOLAR_NAME_MAX_LENGTH);
}

/** Read and normalize the stored certificate name (trimmed, at most 60 chars). */
export function readCertificateName(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return normalizeCertificateName(localStorage.getItem(SCHOLAR_NAME_KEY) ?? "");
  } catch {
    return "";
  }
}

/** Persist the certificate name (trimmed, at most 60 chars). */
export function writeCertificateName(raw: string): string {
  const normalized = normalizeCertificateName(raw);
  if (typeof localStorage !== "undefined") {
    try {
      if (normalized.length > 0) {
        localStorage.setItem(SCHOLAR_NAME_KEY, normalized);
      } else {
        localStorage.removeItem(SCHOLAR_NAME_KEY);
      }
    } catch {
      // storage unavailable
    }
  }
  return normalized;
}

/** Format the certificate name, falling back to the translated default when empty. */
export function displayCertificateName(locale: Locale = getLocale()): string {
  const stored = readCertificateName();
  if (stored.length > 0) return stored;
  return t("scholar.certificate.defaultName", undefined, locale);
}

/** Format gold_cents (hundredths) with at most two decimal places in the active or given locale. */
export function formatPoints(goldCents: number, locale: Locale = getLocale()): string {
  return formatNumber(goldCents / 100, { maximumFractionDigits: 2 }, locale);
}

/** Format the user's points with the style-appropriate currency name and pluralization. */
export function formatCurrency(
  goldCents: number,
  style: Style,
  locale: Locale = getLocale(),
): string {
  const key = style === "scholar" ? "progress.currency.knowledgePoints" : "progress.currency.gold";
  return tn(key, goldCents / 100, { count: formatPoints(goldCents, locale) }, locale);
}
