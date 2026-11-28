import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeckSummary } from "@bibalak/ipc-types";
import { DialogFrame } from "@/features/browse/DialogFrame";
import { Button } from "@/components/ui/button";
import { formatNumber, t, tn } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateTodayCounts } from "@/lib/queryRefresh";
import { pushUndoToast } from "@/lib/undoToast";

/**
 * Confirmation dialog for a full deck progress reset (`reset_deck_progress`,
 * undoable). Shows exact card count, lists every wiped state, and explains
 * that gold balance never goes below zero while levels and achievements remain.
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

  useEffect(() => {
    if (deck) {
      setIncludeSubdecks(true);
    }
  }, [deck]);

  const cardIdsQuery = useQuery({
    queryKey: queryKeys.deckCardIds(deck?.id ?? null, includeSubdecks),
    queryFn: () => ipc.deckCardIds(deck!.id, includeSubdecks),
    enabled: Boolean(deck),
  });

  const cardIds = cardIdsQuery.data ?? [];

  const resetMut = useMutation({
    mutationFn: () => ipc.resetDeckProgress(deck!.id, includeSubdecks),
    onSuccess: (count) => {
      const targetName = deck?.name ?? "";
      const resetCount = count ?? cardIds.length;
      void invalidateTodayCounts(queryClient);
      void queryClient.removeQueries({ queryKey: queryKeys.queueAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      pushUndoToast(tn("undo.action.resetDeckProgress", resetCount, { name: targetName }), () =>
        ipc.undo().then(() => {
          void invalidateTodayCounts(queryClient);
          void queryClient.removeQueries({ queryKey: queryKeys.queueAll });
          void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
        }),
      );
      onDone();
      onClose();
    },
  });

  return (
    <DialogFrame open={Boolean(deck)} title={t("decks.reset.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("decks.reset.title")}</h2>
      {deck && (
        <p className="mb-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {cardIdsQuery.isLoading
            ? t("decks.reset.loading")
            : tn("decks.reset.description", cardIds.length, {
                count: formatNumber(cardIds.length),
                name: deck.name,
              })}
        </p>
      )}
      <div className="mb-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
        <p className="mb-1.5 font-medium text-foreground">{t("decks.reset.wipeListTitle")}</p>
        <ul className="list-disc space-y-1 ps-4">
          <li>{t("decks.reset.wipeCards")}</li>
          <li>{t("decks.reset.wipeHistory")}</li>
          <li>{t("decks.reset.wipeXp")}</li>
        </ul>
        <p className="mt-2 text-foreground/80">{t("decks.reset.goldNote")}</p>
      </div>
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
          disabled={resetMut.isPending || cardIdsQuery.isFetching || cardIds.length === 0}
          onClick={() => resetMut.mutate()}
        >
          {t("decks.reset.confirm")}
        </Button>
      </div>
    </DialogFrame>
  );
}
