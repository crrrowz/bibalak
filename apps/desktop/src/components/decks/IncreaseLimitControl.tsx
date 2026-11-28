import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { formatNumber, t } from "@/lib/i18n";
import { invalidateTodayCounts } from "@/lib/queryRefresh";

/**
 * Inline "study N more new cards today" form. Persists via
 * `ipc.increaseTodayLimit` (which raises this deck and any non-filtered
 * subdecks by `extraNew`, bounded by the parent cap) and refreshes today's
 * counts across decks, motivation, progress, and stats.
 */
const clampExtraNew = (v: number) =>
  Math.min(9999, Math.max(1, Number.isFinite(v) ? Math.trunc(v) : 1));

export function IncreaseLimitControl({
  deckId,
  hasChildren = false,
  onDone,
}: {
  deckId: number;
  hasChildren?: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [extra, setExtra] = useState(10);

  const increaseMut = useMutation({
    mutationFn: (extraNew: number) => ipc.increaseTodayLimit(deckId, clampExtraNew(extraNew)),
    onSuccess: () => {
      void invalidateTodayCounts(queryClient);
      onDone();
    },
  });

  return (
    <div className="space-y-1.5 rounded-lg bg-secondary/40 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("limit.study")}</span>
        <input
          type="number"
          min={1}
          max={9999}
          value={extra}
          onChange={(e) => setExtra(clampExtraNew(Number(e.target.value)))}
          className="h-7 w-16 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          autoFocus
        />
        <span className="text-muted-foreground">{t("limit.moreToday")}</span>
        <Button
          size="sm"
          className="h-7"
          disabled={increaseMut.isPending}
          onClick={() => increaseMut.mutate(clampExtraNew(extra))}
        >
          {t("limit.add")}
        </Button>
      </div>
      {hasChildren && (
        <p className="text-xs text-muted-foreground">
          {t("limit.subdecksHint", { count: formatNumber(extra) })}
        </p>
      )}
    </div>
  );
}

/** Toggle button + inline form; used at the "all done" screen once a session hits the day's cap. */
export function ExtendTodayLimit({ deckId, onDone }: { deckId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <PlusCircle className="size-3.5" />
        {t("limit.increase")}
      </Button>
    );
  }

  return (
    <IncreaseLimitControl
      deckId={deckId}
      onDone={() => {
        setOpen(false);
        onDone();
      }}
    />
  );
}
