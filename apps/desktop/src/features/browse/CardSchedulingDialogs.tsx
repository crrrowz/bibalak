import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { t, tn } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { DialogFrame } from "./DialogFrame";

export function ForgetCardsDialog({
  open,
  cardIds,
  onClose,
  onDone,
}: {
  open: boolean;
  cardIds: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [resetCounts, setResetCounts] = useState(false);

  useEffect(() => {
    if (open) setResetCounts(false);
  }, [open]);

  const mut = useMutation({
    mutationFn: () => ipc.forgetCards(cardIds, resetCounts),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <DialogFrame open={open} title={t("browse.forget.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("browse.forget.title")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {tn("browse.forget.description", cardIds.length)}
      </p>
      <label className="mb-5 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={resetCounts}
          onChange={(e) => setResetCounts(e.target.checked)}
        />
        <span>{t("browse.forget.resetCounts")}</span>
      </label>
      {mut.isError && (
        <p className="mb-3 text-xs text-destructive">{String((mut.error as Error).message)}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={mut.isPending || cardIds.length === 0}
          onClick={() => mut.mutate()}
        >
          {t("browse.forget.confirm")}
        </Button>
      </div>
    </DialogFrame>
  );
}

export function SetDueDateDialog({
  open,
  cardIds,
  onClose,
  onDone,
}: {
  open: boolean;
  cardIds: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [spec, setSpec] = useState("0");

  useEffect(() => {
    if (open) setSpec("0");
  }, [open]);

  const mut = useMutation({
    mutationFn: () => ipc.setDueDate(cardIds, spec),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <DialogFrame open={open} title={t("browse.setDueDate.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("browse.setDueDate.title")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t("browse.setDueDate.hint")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <label htmlFor="browse-due-spec" className="mb-1.5 block text-xs font-medium">
          {t("browse.setDueDate.label")}
        </label>
        <input
          id="browse-due-spec"
          autoFocus
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder={t("browse.setDueDate.placeholder")}
          className="mb-4 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {mut.isError && (
          <p className="mb-3 text-xs text-destructive">{String((mut.error as Error).message)}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={mut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={mut.isPending || cardIds.length === 0}>
            {t("browse.setDueDate.apply")}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function RepositionCardsDialog({
  open,
  cardIds,
  onClose,
  onDone,
}: {
  open: boolean;
  cardIds: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [start, setStart] = useState("1");
  const [step, setStep] = useState("1");
  const [shuffle, setShuffle] = useState(false);
  const [shiftExisting, setShiftExisting] = useState(true);

  useEffect(() => {
    if (open) {
      setStart("1");
      setStep("1");
      setShuffle(false);
      setShiftExisting(true);
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () =>
      ipc.repositionNewCards(
        cardIds,
        Math.max(0, Number(start) || 0),
        Math.max(1, Number(step) || 1),
        shuffle,
        shiftExisting,
      ),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <DialogFrame open={open} title={t("browse.reposition.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("browse.reposition.title")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {tn("browse.reposition.description", cardIds.length)}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="reposition-start" className="mb-1 block text-xs font-medium">
              {t("browse.reposition.start")}
            </label>
            <input
              id="reposition-start"
              type="number"
              min={0}
              autoFocus
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="reposition-step" className="mb-1 block text-xs font-medium">
              {t("browse.reposition.step")}
            </label>
            <input
              id="reposition-step"
              type="number"
              min={1}
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
          <span>{t("browse.reposition.shuffle")}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={shiftExisting}
            onChange={(e) => setShiftExisting(e.target.checked)}
          />
          <span>{t("browse.reposition.shift")}</span>
        </label>
        {mut.isError && (
          <p className="text-xs text-destructive">{String((mut.error as Error).message)}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={mut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={mut.isPending || cardIds.length === 0}>
            {t("browse.reposition.confirm")}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}
