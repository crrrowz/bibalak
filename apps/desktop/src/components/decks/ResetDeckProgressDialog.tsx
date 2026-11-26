import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeckSummary } from "@bibalak/ipc-types";
import { DialogFrame } from "@/features/browse/DialogFrame";
import { Button } from "@/components/ui/button";
import { formatNumber, t, tn } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateTodayCounts } from "@/lib/queryRefresh";

/**
 * Confirmation dialog to reset a deck's progress back to new via the existing
 * `forget_cards` path (undoable). Fetches the exact card IDs via `deckCardIds`.
 */
export function ResetDeckProgressDialog({
  deck,
  hasSubdecks,
  onClose,
  onDone,
}: {
  deck: DeckSummary | null;
  hasSubdecks: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [includeSubdecks, setIncludeSubdecks] = useState(true);
  const [resetCounts, setResetCounts] = useState(false);

  useEffect(() => {
    if (deck) {
      setIncludeSubdecks(true);
      setResetCounts(false);
    }
  }, [deck]);

  const cardIdsQuery = useQuery({
    queryKey: queryKeys.deckCardIds(deck?.id ?? null, includeSubdecks),
    queryFn: () => ipc.deckCardIds(deck!.id, includeSubdecks),
    enabled: Boolean(deck),
  });

  const cardIds = cardIdsQuery.data ?? [];

  const resetMut = useMutation({
    mutationFn: () => ipc.forgetCards(cardIds, resetCounts),
    onSuccess: () => {
      void invalidateTodayCounts(queryClient);
      onDone();
      onClose();
    },
  });

  return (
    <DialogFrame open={Boolean(deck)} title={t("decks.reset.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("decks.reset.title")}</h2>
      {deck && (
        <p className="mb-4 text-sm text-muted-foreground">
          {cardIdsQuery.isLoading
            ? t("decks.reset.loading")
            : tn("decks.reset.description", cardIds.length, {
                count: formatNumber(cardIds.length),
                name: deck.name,
              })}
        </p>
      )}
      <div className="mb-4 space-y-2">
        <label
          className={
            hasSubdecks
              ? "flex cursor-pointer items-center gap-2 text-sm"
              : "flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
          }
        >
          <input
            type="checkbox"
            checked={includeSubdecks}
            onChange={(e) => setIncludeSubdecks(e.target.checked)}
          />
          <span>{t("decks.reset.includeSubdecks")}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={resetCounts}
            onChange={(e) => setResetCounts(e.target.checked)}
          />
          <span>{t("decks.reset.resetCounts")}</span>
        </label>
      </div>
      {!cardIdsQuery.isLoading && !cardIdsQuery.isError && cardIds.length === 0 && (
        <p className="mb-3 text-xs text-muted-foreground">{t("decks.reset.empty")}</p>
      )}
      {cardIdsQuery.isError && (
        <p className="mb-3 text-xs text-destructive">{errorMessage(cardIdsQuery.error)}</p>
      )}
      {resetMut.isError && (
        <p className="mb-3 text-xs text-destructive">{errorMessage(resetMut.error)}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={resetMut.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={resetMut.isPending || cardIdsQuery.isLoading || cardIds.length === 0}
          onClick={() => resetMut.mutate()}
        >
          {t("decks.reset.confirm")}
        </Button>
      </div>
    </DialogFrame>
  );
}
