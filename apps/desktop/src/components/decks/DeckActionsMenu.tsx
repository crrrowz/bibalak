import {
  MoreHorizontal,
  Pencil,
  Play,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { t } from "@/lib/i18n";

/** Overflow menu for a deck row: study, rename, limit, options, AI quality, reset progress, delete (and
 * rebuild/empty for filtered decks). */
export function DeckActionsMenu({
  deck,
  onStudy,
  onRename,
  onIncreaseLimit,
  onOptions,
  onCheckQuality,
  onResetProgress,
  onExport,
  onDelete,
  onRebuild,
  onEmpty,
}: {
  deck: DeckSummary;
  onStudy: () => void;
  onRename: () => void;
  onIncreaseLimit: () => void;
  onOptions: () => void;
  onCheckQuality?: () => void;
  onResetProgress?: () => void;
  onExport?: () => void;
  onDelete: () => void;
  onRebuild: () => void;
  onEmpty: () => void;
}) {
  return (
    <ActionMenu
      menuLabel={t("decks.actions.menu", { name: deck.name })}
      triggerAriaLabel={t("decks.actions.more", { name: deck.name })}
      triggerClassName="rounded p-1.5 text-muted-foreground transition-opacity hover:bg-secondary hover:text-foreground"
      triggerContent={<MoreHorizontal className="size-4" />}
      stopContainerClickPropagation
    >
      <ActionMenuItem icon={<Play />} label={t("decks.study")} onSelect={onStudy} />
      {!deck.is_filtered && (
        <ActionMenuItem icon={<Pencil />} label={t("common.rename")} onSelect={onRename} />
      )}
      {!deck.is_filtered && (
        <ActionMenuItem
          icon={<PlusCircle />}
          label={t("decks.actions.increaseLimit")}
          onSelect={onIncreaseLimit}
        />
      )}
      {!deck.is_filtered && (
        <ActionMenuItem icon={<Settings />} label={t("decks.options")} onSelect={onOptions} />
      )}
      {!deck.is_filtered && onCheckQuality && (
        <ActionMenuItem
          icon={<Sparkles />}
          label={t("ai.quality.menuAction")}
          onSelect={onCheckQuality}
        />
      )}
      {!deck.is_filtered && onResetProgress && (
        <ActionMenuItem
          icon={<RotateCcw />}
          label={t("decks.actions.resetProgress")}
          onSelect={onResetProgress}
        />
      )}
      {!deck.is_filtered && onExport && (
        <ActionMenuItem icon={<Upload />} label={t("decks.export")} onSelect={onExport} />
      )}
      {deck.is_filtered && (
        <ActionMenuItem icon={<RefreshCw />} label={t("decks.rebuild")} onSelect={onRebuild} />
      )}
      {deck.is_filtered && (
        <ActionMenuItem icon={<X />} label={t("decks.empty")} onSelect={onEmpty} />
      )}
      <ActionMenuSeparator />
      <ActionMenuItem icon={<Trash2 />} label={t("common.delete")} onSelect={onDelete} danger />
    </ActionMenu>
  );
}
