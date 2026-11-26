import { useId, useState } from "react";
import type { CustomRewardDto } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RewardIconGlyph } from "./rewardIcons";
import { REWARD_ICON_KEYS, type RewardSubmitHandler } from "./shopTypes";

const MAX_TITLE_CHARS = 80;
const MAX_NOTES_CHARS = 300;
const MIN_GOLD = 1;
const MAX_GOLD = 100_000;

interface CustomRewardDialogProps {
  open: boolean;
  reward?: CustomRewardDto | null;
  nextSortOrder: number;
  onSubmit: RewardSubmitHandler;
  onClose: () => void;
}

/** Modal create/edit form for Game custom rewards (spec 14a §7). */
export function CustomRewardDialog({
  open,
  reward,
  nextSortOrder,
  onSubmit,
  onClose,
}: CustomRewardDialogProps) {
  const headingId = useId();
  const titleId = useId();
  const costId = useId();
  const notesId = useId();

  const isEdit = Boolean(reward);
  const [title, setTitle] = useState(reward?.title ?? "");
  const [costGold, setCostGold] = useState(
    reward ? String(Math.max(MIN_GOLD, Math.round(reward.cost_cents / 100))) : "25",
  );
  const [notes, setNotes] = useState(reward?.notes ?? "");
  const [iconKey, setIconKey] = useState<string>(reward?.icon_key ?? "gift");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 1 || trimmedTitle.length > MAX_TITLE_CHARS) {
      setError(t("game.rewards.titleError"));
      return;
    }
    const parsedGold = Number(costGold);
    if (!Number.isInteger(parsedGold) || parsedGold < MIN_GOLD || parsedGold > MAX_GOLD) {
      setError(t("game.rewards.costError"));
      return;
    }
    const trimmedNotes = notes.trim().slice(0, MAX_NOTES_CHARS);
    setError(null);
    setIsPending(true);
    try {
      await onSubmit({
        title: trimmedTitle,
        notes: trimmedNotes,
        cost_cents: parsedGold * 100,
        icon_key: iconKey,
        sort_order: reward?.sort_order ?? nextSortOrder,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={headingId}
      closeOnEscape={!isPending}
      closeOnBackdrop={!isPending}
      className="max-w-md p-6"
    >
      <h2 id={headingId} className="mb-4 text-base font-semibold text-foreground">
        {isEdit ? t("game.rewards.edit") : t("game.rewards.new")}
      </h2>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={titleId} className="block text-xs font-medium text-foreground">
            {t("game.rewards.titleLabel")}
          </label>
          <input
            id={titleId}
            type="text"
            dir="auto"
            maxLength={MAX_TITLE_CHARS}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={costId} className="block text-xs font-medium text-foreground">
            {t("game.rewards.costLabel")}
          </label>
          <input
            id={costId}
            type="number"
            min={MIN_GOLD}
            max={MAX_GOLD}
            step={1}
            value={costGold}
            onChange={(e) => setCostGold(e.target.value)}
            required
            className="tnum h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={notesId} className="block text-xs font-medium text-foreground">
            {t("game.rewards.notesLabel")}
          </label>
          <textarea
            id={notesId}
            dir="auto"
            rows={2}
            maxLength={MAX_NOTES_CHARS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-foreground">
            {t("game.rewards.iconLabel")}
          </span>
          <div
            role="radiogroup"
            aria-label={t("game.rewards.iconLabel")}
            className="grid grid-cols-4 gap-2 sm:grid-cols-8"
          >
            {REWARD_ICON_KEYS.map((key) => {
              const selected = iconKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={key}
                  onClick={() => setIconKey(key)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <RewardIconGlyph iconKey={key} className="size-4" />
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            {t("game.rewards.cancel")}
          </Button>
          <Button type="submit" disabled={isPending}>
            {t("game.rewards.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
