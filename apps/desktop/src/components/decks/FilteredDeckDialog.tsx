import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import type { FilteredDeckConfig } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { errorMessage, ipc } from "@/lib/ipc";
import { t } from "@/lib/i18n";

/** Indexes match the Anki filtered-deck order values; labels translate at render time. */
const ORDER_KEYS = [
  "filtered.order.random",
  "filtered.order.due",
  "filtered.order.added",
  "filtered.order.interval",
  "filtered.order.lapses",
] as const;

/** Create or rebuild a filtered (custom study) deck. */
export function FilteredDeckDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: FilteredDeckConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? t("filtered.defaultName"));
  const [search, setSearch] = useState(initial?.search ?? "is:due");
  const [order, setOrder] = useState(initial?.order ?? 0);
  const [limit, setLimit] = useState(initial?.limit ?? 100);

  const createMut = useMutation({
    mutationFn: () => ipc.createFilteredDeck(name.trim(), search.trim(), order, limit),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const rebuildMut = useMutation({
    mutationFn: () => ipc.rebuildFiltered(initial!.deck_id),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const isRebuild = !!initial;
  const isPending = createMut.isPending || rebuildMut.isPending;
  const error = createMut.error ?? rebuildMut.error;

  return (
    <Dialog
      open
      onClose={onClose}
      ariaLabel={isRebuild ? t("filtered.titleRebuild") : t("filtered.titleNew")}
      className="max-w-md p-6"
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {isRebuild ? t("filtered.titleRebuild") : t("filtered.titleNew")}
        </h2>
        <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="space-y-4">
        {!isRebuild && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("filtered.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("filtered.query")}</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filtered.queryPlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("filtered.queryHint")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("filtered.order")}</label>
            <Select value={order} onChange={(e) => setOrder(Number(e.target.value))}>
              {ORDER_KEYS.map((key, i) => (
                <option key={i} value={i}>
                  {t(key)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("filtered.limit")}</label>
            <input
              type="number"
              min={1}
              max={9999}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(9999, Number(e.target.value))))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{errorMessage(error)}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          disabled={isPending || !search.trim() || (!isRebuild && !name.trim())}
          onClick={() => (isRebuild ? rebuildMut.mutate() : createMut.mutate())}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {isPending ? t("filtered.building") : isRebuild ? t("decks.rebuild") : t("common.create")}
        </Button>
      </div>
    </Dialog>
  );
}
