import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { useDismissComebackOffer, useMotivationState } from "./useMotivation";

/**
 * Warm, non-blaming welcome-back card rendered above `TodayCard` when the
 * user returns after >= 7 days away and has an active comeback bonus offer.
 */
export function ComebackCard() {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const { data: state } = useMotivationState();
  const dismissMut = useDismissComebackOffer();

  if (!tauri || !state?.comeback_offer) return null;

  const offer = state.comeback_offer;
  const gold = formatNumber(offer.reward_gold_cents / 100);

  const titleKey =
    style === "game"
      ? "motivation.comeback.title.game"
      : style === "scholar"
        ? "motivation.comeback.title.scholar"
        : "motivation.comeback.title.default";

  const bodyKey =
    style === "game"
      ? "motivation.comeback.body.game"
      : style === "scholar"
        ? "motivation.comeback.body.scholar"
        : "motivation.comeback.body.default";

  return (
    <section
      data-testid="comeback-card"
      aria-label={t(titleKey)}
      className={cn(
        "mx-4 mt-4 rounded-xl border bg-card px-4 py-3 sm:mx-6 lg:mx-8",
        style === "game" ? "border-[hsl(var(--game-gold))]/50" : "border-primary/35",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Sparkles
            className={cn(
              "mt-0.5 size-4 shrink-0",
              style === "game" ? "text-[hsl(var(--game-gold))]" : "text-primary",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">{t(titleKey)}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">{t(bodyKey, { gold })}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={dismissMut.isPending}
          aria-label={t("motivation.comeback.dismiss")}
          onClick={() => dismissMut.mutate()}
          className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span>{t("motivation.comeback.dismiss")}</span>
        </Button>
      </div>
    </section>
  );
}
