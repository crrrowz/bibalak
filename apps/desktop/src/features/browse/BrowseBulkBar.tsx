import { useState, type RefObject } from "react";
import {
  ArrowUpDown,
  Calendar,
  Eye,
  Flag,
  Layers,
  MinusCircle,
  MoreHorizontal,
  RefreshCw,
  Replace,
  RotateCcw,
  SkipForward,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FLAG_COLORS } from "@/features/browse/browseHelpers";
import type { BrowseDialogKind } from "@/lib/browseColumns";
import { errorMessage } from "@/lib/ipc";
import { formatNumber, t } from "@/lib/i18n";

export type BulkActionKind = null | "addTag" | "removeTag" | "moveDeck" | "flag";

interface BrowseBulkBarProps {
  bulkRef: RefObject<HTMLDivElement | null>;
  selectedCount: number;
  hasSuspended: boolean;
  hasUnsuspended: boolean;
  hasBuried: boolean;
  hasUnburied: boolean;
  hasNew: boolean;
  isSuspendPending: boolean;
  isUnsuspendPending: boolean;
  isBuryPending: boolean;
  isUnburyPending: boolean;
  isDeletePending: boolean;
  isMoveDeckPending: boolean;
  moveDeckError: unknown;
  bulkAction: BulkActionKind;
  setBulkAction: (action: BulkActionKind) => void;
  bulkTag: string;
  setBulkTag: (tag: string) => void;
  existingTags: string[];
  deckFilter: string;
  setDeckFilter: (filter: string) => void;
  selectedDeckId: number | null;
  setSelectedDeckId: (id: number | null) => void;
  availableDecks: DeckSummary[];
  bulkError: unknown;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onBury: () => void;
  onUnbury: () => void;
  onSetFlag: (flag: number) => void;
  onSubmitTags: (tags: string[], action: "addTag" | "removeTag") => void;
  onMoveDeck: (deckId: number) => void;
  onOpenDialog: (dialog: Exclude<BrowseDialogKind, null>) => void;
  onCheckQuality?: () => void;
  onRequestDelete: () => void;
  onClearSelection: () => void;
}

/** Multi-select bulk actions footer bar rendered when cards or notes are checked in Browse. */
export function BrowseBulkBar({
  bulkRef,
  selectedCount,
  hasSuspended,
  hasUnsuspended,
  hasBuried,
  hasUnburied,
  hasNew,
  isSuspendPending,
  isUnsuspendPending,
  isBuryPending,
  isUnburyPending,
  isDeletePending,
  isMoveDeckPending,
  moveDeckError,
  bulkAction,
  setBulkAction,
  bulkTag,
  setBulkTag,
  existingTags,
  deckFilter,
  setDeckFilter,
  selectedDeckId,
  setSelectedDeckId,
  availableDecks,
  bulkError,
  onSuspend,
  onUnsuspend,
  onBury,
  onUnbury,
  onSetFlag,
  onSubmitTags,
  onMoveDeck,
  onOpenDialog,
  onCheckQuality,
  onRequestDelete,
  onClearSelection,
}: BrowseBulkBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const toggleSubPanel = (kind: Exclude<BulkActionKind, null>) => {
    setMoreOpen(false);
    setBulkAction(bulkAction === kind ? null : kind);
  };

  const hasStudyState = hasUnsuspended || hasSuspended || hasUnburied || hasBuried;

  return (
    <div
      ref={bulkRef}
      className="flex flex-col gap-2 border-t border-border bg-secondary/60 px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap text-sm font-medium">
            {t("browse.selected", { count: formatNumber(selectedCount) })}
          </span>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            {t("browse.clear")}
          </Button>
        </div>

        <div className="h-5 w-px bg-border" aria-hidden="true" />

        {hasStudyState && (
          <div
            role="group"
            aria-label={t("browse.bulk.studyState")}
            className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background/80 p-0.5"
          >
            {hasUnsuspended && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={isSuspendPending}
                onClick={onSuspend}
              >
                <MinusCircle className="size-3.5" /> {t("study.suspend")}
              </Button>
            )}
            {hasSuspended && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={isUnsuspendPending}
                onClick={onUnsuspend}
              >
                <MinusCircle className="size-3.5" /> {t("browse.unsuspend")}
              </Button>
            )}
            {hasUnburied && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={isBuryPending}
                onClick={onBury}
              >
                <SkipForward className="size-3.5 rtl:-scale-x-100" /> {t("study.bury")}
              </Button>
            )}
            {hasBuried && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={isUnburyPending}
                onClick={onUnbury}
              >
                <SkipForward className="size-3.5 rtl:-scale-x-100" /> {t("browse.unbury")}
              </Button>
            )}
          </div>
        )}

        <Button
          variant={bulkAction === "flag" ? "secondary" : "outline"}
          size="sm"
          aria-expanded={bulkAction === "flag"}
          onClick={() => toggleSubPanel("flag")}
        >
          <Flag className="size-3.5" /> {t("browse.flag")}
        </Button>

        <div
          role="group"
          aria-label={t("browse.bulk.tags")}
          className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background/80 p-0.5"
        >
          <Button
            variant={bulkAction === "addTag" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-expanded={bulkAction === "addTag"}
            onClick={() => toggleSubPanel("addTag")}
          >
            <Tag className="size-3.5" /> {t("browse.addTag")}
          </Button>
          <Button
            variant={bulkAction === "removeTag" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-expanded={bulkAction === "removeTag"}
            onClick={() => toggleSubPanel("removeTag")}
          >
            <Tag className="size-3.5" /> {t("browse.removeTag")}
          </Button>
        </div>

        <Button
          variant={bulkAction === "moveDeck" ? "secondary" : "outline"}
          size="sm"
          aria-expanded={bulkAction === "moveDeck"}
          onClick={() => toggleSubPanel("moveDeck")}
        >
          <Layers className="size-3.5" /> {t("browse.moveToDeck")}
        </Button>

        <ActionMenu
          menuLabel={t("browse.bulk.moreActions")}
          triggerVariant="outline"
          triggerSize="sm"
          placement="top"
          align="end"
          open={moreOpen}
          onOpenChange={(next) => {
            setMoreOpen(next);
            if (next) setBulkAction(null);
          }}
          triggerContent={
            <>
              <MoreHorizontal className="size-3.5" /> {t("browse.bulk.more")}
            </>
          }
        >
          <ActionMenuItem
            icon={<Eye />}
            label={t("browse.preview")}
            onSelect={() => onOpenDialog("preview")}
          />
          <ActionMenuItem
            icon={<RotateCcw />}
            label={t("browse.forget")}
            onSelect={() => onOpenDialog("forget")}
          />
          <ActionMenuItem
            icon={<Calendar />}
            label={t("browse.setDueDate")}
            onSelect={() => onOpenDialog("setDueDate")}
          />
          {hasNew && (
            <ActionMenuItem
              icon={<ArrowUpDown />}
              label={t("browse.reposition")}
              onSelect={() => onOpenDialog("reposition")}
            />
          )}
          <ActionMenuSeparator />
          <ActionMenuItem
            icon={<Replace />}
            label={t("browse.findReplace")}
            onSelect={() => onOpenDialog("findReplace")}
          />
          <ActionMenuItem
            icon={<RefreshCw />}
            label={t("browse.changeNotetype")}
            onSelect={() => onOpenDialog("changeNotetype")}
          />
          {onCheckQuality && (
            <>
              <ActionMenuSeparator />
              <ActionMenuItem
                icon={<Sparkles />}
                label={t("ai.quality.menuAction")}
                onSelect={onCheckQuality}
              />
            </>
          )}
        </ActionMenu>

        <div className="ms-auto flex items-center gap-2">
          <div className="h-5 w-px bg-border" aria-hidden="true" />
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isDeletePending}
            onClick={onRequestDelete}
          >
            <Trash2 className="size-3.5" /> {t("common.delete")}
          </Button>
        </div>
      </div>

      {bulkError ? (
        <span role="alert" className="text-xs text-destructive">
          {errorMessage(bulkError)}
        </span>
      ) : null}

      {bulkAction === "flag" && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-1 rounded border border-border bg-background p-1">
            {[1, 2, 3, 4, 5, 6, 7].map((f) => (
              <button
                key={f}
                type="button"
                title={t("browse.flagNumber", { n: f })}
                aria-label={t("browse.flagNumber", { n: f })}
                className={`rounded p-1 hover:bg-accent ${FLAG_COLORS[f]}`}
                onClick={() => onSetFlag(f)}
              >
                <Flag className="size-3.5" />
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onSetFlag(0)}
            >
              {t("browse.clearFlag")}
            </Button>
          </div>
        </div>
      )}

      {(bulkAction === "addTag" || bulkAction === "removeTag") && (
        <form
          className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const tagList = bulkTag.trim().split(/\s+/).filter(Boolean);
            if (tagList.length > 0) {
              onSubmitTags(tagList, bulkAction);
            }
          }}
        >
          <input
            autoFocus
            list="browse-existing-tags"
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            placeholder={t("browse.tagName")}
            className="h-7 min-w-[9rem] rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring sm:w-44"
          />
          <datalist id="browse-existing-tags">
            {existingTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <Button type="submit" size="sm" className="h-7 text-xs">
            {bulkAction === "addTag" ? t("browse.add") : t("browse.remove")}
          </Button>
        </form>
      )}

      {bulkAction === "moveDeck" && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
          <input
            autoFocus
            value={deckFilter}
            onChange={(e) => setDeckFilter(e.target.value)}
            placeholder={t("browse.filterDecks")}
            className="h-7 min-w-[8rem] rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring sm:w-36"
          />
          <Select
            selectSize="xs"
            containerClassName="w-auto max-w-xs"
            aria-label={t("browse.selectDeck")}
            value={selectedDeckId ?? ""}
            onChange={(e) => setSelectedDeckId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t("browse.selectDeck")}</option>
            {availableDecks
              .filter((d) => d.name.toLowerCase().includes(deckFilter.toLowerCase()))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={selectedDeckId === null || isMoveDeckPending}
            onClick={() => {
              if (selectedDeckId !== null) onMoveDeck(selectedDeckId);
            }}
          >
            {t("browse.move")}
          </Button>
          {Boolean(moveDeckError) && (
            <span className="text-xs text-destructive">{errorMessage(moveDeckError)}</span>
          )}
        </div>
      )}
    </div>
  );
}
