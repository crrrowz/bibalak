import { formatDate, formatNumber, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";

const PERMISSION_LABELS: Record<string, LocaleKey> = {
  "read:decks": "settings.perm.read_decks",
  "read:notes": "settings.perm.read_notes",
  "write:cards": "settings.perm.write_cards",
  "ui:panel": "settings.perm.ui_panel",
  "ui:command": "settings.perm.ui_command",
  "ui:review-button": "settings.perm.ui_review_button",
  "events:listen": "settings.perm.events_listen",
  "net:fetch": "settings.perm.net_fetch",
  "ai:card-hint": "settings.perm.ai_card_hint",
  "ai:note-fill-back": "settings.perm.ai_note_fill_back",
  "ai:deck-summary": "settings.perm.ai_deck_summary",
  fs_read: "settings.perm.fs_read",
  fs_write: "settings.perm.fs_write",
  shell_exec: "settings.perm.shell_exec",
  network: "settings.perm.network",
};

export function permissionLabel(perm: string): string {
  return perm in PERMISSION_LABELS ? t(PERMISSION_LABELS[perm]) : perm;
}

export function fmt_size(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) {
    return `${formatNumber(bytes / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  }
  return `${formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export function fmt_date(ms: number): string {
  return formatDate(ms, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
