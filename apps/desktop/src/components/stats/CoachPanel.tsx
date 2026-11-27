import { useCallback, useMemo, useState } from "react";
import { ArrowUpRight, Check, Copy, Layers, RefreshCw, Sparkles, X } from "lucide-react";
import type { CoachReport, DeckStat } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/lib/i18n";
import { toast } from "@/stores/toast";

export interface CoachPanelProps {
  report: CoachReport;
  onSelectDeck: (deckId: number) => void;
  onClose: () => void;
  onRefresh?: () => void;
  deckStats?: DeckStat[];
}

export function CoachPanel({
  report,
  onSelectDeck,
  onClose,
  onRefresh,
  deckStats = [],
}: CoachPanelProps) {
  const [copied, setCopied] = useState(false);

  const deckMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of deckStats) {
      map.set(d.deck_id, d.name);
    }
    return map;
  }, [deckStats]);

  const handleCopyPlan = useCallback(async () => {
    const lines: string[] = [];
    lines.push(t("ai.coach.panelTitle"));
    lines.push("");
    lines.push(`${t("ai.coach.summaryHeading")}:`);
    lines.push(report.summary);
    lines.push("");
    lines.push(`${t("ai.coach.adviceHeading")}:`);
    report.advice.forEach((item, idx) => {
      const deckLabel = item.deck_id
        ? ` (${deckMap.get(item.deck_id) ?? `#${formatNumber(item.deck_id)}`})`
        : "";
      lines.push(`${formatNumber(idx + 1)}. ${item.title}${deckLabel}: ${item.detail}`);
    });
    lines.push("");
    lines.push(`${t("ai.coach.planHeading")}:`);
    report.plan.forEach((day) => {
      lines.push(
        `${t("ai.coach.dayLabel", { day: formatNumber(day.day) })}: ${formatNumber(day.reviews)} ${t(
          "ai.coach.reviewsLabel",
        )}, ${formatNumber(day.new_cards)} ${t("ai.coach.newCardsLabel")} — ${day.focus}`,
      );
    });
    lines.push("");
    lines.push(t("ai.coach.disclaimer"));

    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("ai.coach.copiedToast"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.success(t("ai.coach.copiedToast"));
    }
  }, [report, deckMap]);

  return (
    <section
      data-testid="study-coach-panel"
      className="space-y-5 rounded-[14px] border border-border bg-card p-5 text-start"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">{t("ai.coach.panelTitle")}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleCopyPlan()}
            className="gap-1.5 text-xs"
          >
            {copied ? (
              <Check className="size-3.5 text-good" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            <span>{t("ai.coach.copyPlan")}</span>
          </Button>
          {onRefresh && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              aria-label={t("common.retry")}
            >
              <RefreshCw className="size-3.5" aria-hidden />
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("ai.coach.summaryHeading")}
        </h3>
        <div
          dir="auto"
          className="rounded-lg border border-border/70 bg-muted/30 p-3.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap"
        >
          {report.summary}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("ai.coach.adviceHeading")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {report.advice.map((item, idx) => (
            <div
              key={idx}
              className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-background p-3"
            >
              <div className="space-y-1">
                <h4 dir="auto" className="text-sm font-semibold text-foreground">
                  {item.title}
                </h4>
                <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              </div>
              {item.deck_id != null && (
                <div className="pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectDeck(item.deck_id!)}
                    className="h-6 gap-1 px-2 text-[11px]"
                  >
                    <Layers className="size-3 text-muted-foreground" aria-hidden />
                    <span className="max-w-[140px] truncate">
                      {deckMap.get(item.deck_id) ?? t("ai.coach.deckBadge", { id: item.deck_id })}
                    </span>
                    <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("ai.coach.planHeading")}
        </h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">
                  {t("ai.coach.dayLabel", { day: "" }).trim()}
                </th>
                <th className="px-3 py-2 text-start font-medium">{t("ai.coach.reviewsLabel")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("ai.coach.newCardsLabel")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("ai.coach.focusLabel")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {report.plan.map((day) => (
                <tr key={day.day} className="hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                    {t("ai.coach.dayLabel", { day: day.day })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                    {formatNumber(day.reviews)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                    {formatNumber(day.new_cards)}
                  </td>
                  <td dir="auto" className="px-3 py-2 text-foreground/90">
                    {day.focus}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground italic">{t("ai.coach.disclaimer")}</p>
    </section>
  );
}
