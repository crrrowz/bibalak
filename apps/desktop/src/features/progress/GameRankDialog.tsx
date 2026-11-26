import type { AvatarProfileDto, EquippedSlotDto } from "@bibalak/ipc-types";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { RankEmblemIcon } from "@/components/icons/game";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatNumber, t } from "@/lib/i18n";
import { gameRankByIndex } from "@/lib/styles/game";

export interface GameRankDialogProps {
  open: boolean;
  rankIndex: number;
  level: number;
  profile?: AvatarProfileDto | null;
  equipped?: EquippedSlotDto[] | null;
  onClose: () => void;
}

/**
 * Rank-up celebration dialog shown once per newly reached Game rank.
 * Fade-only transition honoring `prefers-reduced-motion`; zero sound here (played by host).
 */
export function GameRankDialog({
  open,
  rankIndex,
  level,
  profile,
  equipped,
  onClose,
}: GameRankDialogProps) {
  const rankTitle = t(gameRankByIndex(rankIndex));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabelledBy="game-rank-dialog-title"
      animation="fade"
      className="max-w-md p-3 shadow-none"
    >
      <div className="rounded-lg border-2 border-primary/40 bg-card px-6 py-6 text-center">
        <div className="mb-3 flex flex-col items-center gap-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
            <RankEmblemIcon className="size-4" />
            <span>{t("game.celebration.rankUp")}</span>
          </div>
          <AvatarStage
            style="game"
            size={128}
            level={level}
            profile={profile}
            equipped={equipped}
            className="rounded-xl border border-border"
          />
        </div>

        <h2
          id="game-rank-dialog-title"
          className="text-2xl font-semibold tracking-tight text-primary"
        >
          {rankTitle}
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          {t("game.celebration.levelUpBody", { level: formatNumber(level) })}
        </p>

        <div className="mt-6 flex justify-center">
          <Button type="button" onClick={onClose}>
            {t("game.celebration.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
