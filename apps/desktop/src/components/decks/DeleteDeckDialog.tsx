import { AlertTriangle, Trash2 } from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

export function DeleteDeckDialog({
  deck,
  onCancel,
  onConfirm,
  isPending,
}: {
  deck: DeckSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog
      open={Boolean(deck)}
      onClose={onCancel}
      role="alertdialog"
      ariaLabel={t("decks.delete.title")}
      className="max-w-sm p-6"
    >
      {deck && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("decks.delete.title")}</p>
              <p className="text-xs text-muted-foreground">
                {deck.is_filtered ? t("decks.delete.filteredNote") : t("decks.delete.permanent")}
              </p>
            </div>
          </div>
          <p
            dir="auto"
            className="mb-6 min-w-0 rounded-md bg-secondary/60 px-3 py-2 text-sm font-medium [overflow-wrap:anywhere]"
          >
            {deck.name}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
              onClick={onConfirm}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t("common.delete")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
