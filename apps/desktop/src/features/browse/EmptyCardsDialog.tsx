import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { t, tn } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { DialogFrame } from "./DialogFrame";

/** Scans the collection for cards whose rendered front is empty and deletes confirmed cards. */
export function EmptyCardsDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const tauri = isTauri();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const emptyQuery = useQuery({
    queryKey: queryKeys.emptyCards,
    queryFn: () => ipc.findEmptyCards(),
    enabled: open && tauri,
  });

  useEffect(() => {
    if (open) {
      setConfirmDelete(false);
    }
  }, [open]);

  const deleteMut = useMutation({
    mutationFn: (cardIds: number[]) => ipc.deleteEmptyCards(cardIds),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const items = emptyQuery.data ?? [];

  return (
    <DialogFrame open={open} title={t("browse.emptyCards.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("browse.emptyCards.title")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("browse.emptyCards.description")}</p>

      {emptyQuery.isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : emptyQuery.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String((emptyQuery.error as Error).message)}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-md bg-secondary/50 px-3 py-3 text-sm text-muted-foreground">
          {t("browse.emptyCards.none")}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground">
            {tn("browse.emptyCards.found", items.length)}
          </p>
          <ul className="max-h-56 divide-y divide-border overflow-auto rounded-md border border-border text-xs">
            {items.map((item) => (
              <li key={item.card_id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.sort_field || t("browse.empty")}</div>
                  <div className="truncate text-muted-foreground">
                    {item.notetype_name} · {item.template_name} · {item.deck_name}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.checked)}
            />
            <span>{t("browse.emptyCards.confirmDelete")}</span>
          </label>
        </div>
      )}

      {deleteMut.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {String((deleteMut.error as Error).message)}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={deleteMut.isPending}>
          {t("common.close")}
        </Button>
        {items.length > 0 && (
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmDelete || deleteMut.isPending}
            onClick={() => deleteMut.mutate(items.map((i) => i.card_id))}
          >
            {t("browse.emptyCards.deleteBtn")}
          </Button>
        )}
      </div>
    </DialogFrame>
  );
}
