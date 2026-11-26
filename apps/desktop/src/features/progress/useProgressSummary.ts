import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";

/** Format a backend `YYYY-MM-DD` string in the active locale without UTC day shift. */
export function formatBackendDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return formatDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])), {
    dateStyle: "medium",
  });
}

/** Read-only query for the user's XP, level, and gold summary. */
export function useProgressSummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.progressSummary,
    queryFn: ipc.progressSummary,
    enabled: isTauri() && enabled,
  });
}

/** Read-only daily reward history for certificate milestone dates. */
export function useProgressHistory(enabled = true) {
  return useQuery({
    queryKey: queryKeys.progressHistory,
    queryFn: ipc.progressHistory,
    enabled: isTauri() && enabled,
  });
}

/** Read-only daily study log (revlog + ledger). */
export function useStudyDays(limit = 30, enabled = true) {
  return useQuery({
    queryKey: queryKeys.studyDays(limit),
    queryFn: () => ipc.studyDays(limit),
    enabled: isTauri() && enabled,
  });
}

/** Read-only per-top-deck progress rollup. */
export function useProgressByDeck(enabled = true) {
  return useQuery({
    queryKey: queryKeys.progressByDeck,
    queryFn: ipc.progressByDeck,
    enabled: isTauri() && enabled,
  });
}

/** Read-only "yesterday" summary (non-null once per day when yesterday had activity). */
export function useYesterdaySummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.yesterdaySummary,
    queryFn: ipc.yesterdaySummary,
    enabled: isTauri() && enabled,
  });
}
