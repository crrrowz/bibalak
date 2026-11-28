import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Layers,
  Play,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { dur, ease } from "@/lib/motion";
import { DeckCounts } from "./DeckCounts";
import { DeckActionsMenu } from "./DeckActionsMenu";
import { IncreaseLimitControl } from "./IncreaseLimitControl";
import { t } from "@/lib/i18n";

function deckDepth(name: string): number {
  return name.split("::").length - 1;
}

function deckLabel(name: string): string {
  const parts = name.split("::");
  return parts[parts.length - 1];
}

export function DeckRow({
  deck,
  depth: explicitDepth,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  onStudy,
  onRename,
  onOptions,
  onCheckQuality,
  onResetProgress,
  onExport,
  onDelete,
  onRebuild,
  onEmpty,
}: {
  deck: DeckSummary;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onStudy: () => void;
  onRename: (newName: string) => void;
  onOptions: () => void;
  onCheckQuality?: () => void;
  onResetProgress?: () => void;
  onExport?: () => void;
  onDelete: () => void;
  onRebuild: () => void;
  onEmpty: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(deck.name);
  const [limitOpen, setLimitOpen] = useState(false);

  const depth = Math.min(
    explicitDepth !== undefined
      ? explicitDepth
      : deck.parent_id === null
        ? 0
        : deckDepth(deck.name),
    6,
  );

  function submitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed && trimmed !== deck.name) onRename(trimmed);
    else setRenameValue(deck.name);
  }

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="group flex items-center gap-3 py-3 pe-4 sm:pe-6 lg:pe-8 hover:bg-accent/40"
        style={{ paddingInlineStart: `${2 + depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label={collapsed ? t("decks.expand") : t("decks.collapse")}
            title={collapsed ? t("decks.expand") : t("decks.collapse")}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.();
            }}
          >
            {collapsed ? (
              <ChevronRight className="size-3.5 rtl:-scale-x-100" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          className="flex flex-1 items-center gap-3 overflow-hidden text-start"
          onClick={() => !renaming && onStudy()}
        >
          {deck.is_filtered ? (
            <Filter className="size-4 shrink-0 text-purple-500" />
          ) : (
            <Layers className="size-4 shrink-0 text-muted-foreground" />
          )}
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") {
                  setRenameValue(deck.name);
                  setRenaming(false);
                }
              }}
              className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <span className="flex-1 truncate text-sm font-medium">{deckLabel(deck.name)}</span>
          )}
          {hasChildren && !renaming && (
            <span
              data-testid="deck-includes-subdecks"
              title={t("decks.rolledUpHint")}
              className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {t("decks.includesSubdecks")}
            </span>
          )}
          {deck.is_filtered && !renaming && (
            <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {t("decks.filteredBadge")}
            </span>
          )}
        </button>

        <span title={hasChildren ? t("decks.rolledUpHint") : undefined}>
          <DeckCounts
            newCount={deck.new_count}
            learningCount={deck.learning_count}
            reviewCount={deck.review_count}
            columnWidth="w-11 shrink-0"
          />
        </span>

        <div className="flex w-36 shrink-0 items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("decks.studyNamed", { name: deck.name })}
            onClick={(e) => {
              e.stopPropagation();
              onStudy();
            }}
            title={t("decks.study")}
          >
            <Play className="size-4" />
          </Button>
          {deck.is_filtered ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("decks.rebuildNamed", { name: deck.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onRebuild();
                }}
                title={t("decks.rebuildFiltered")}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("decks.emptyNamed", { name: deck.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onEmpty();
                }}
                title={t("decks.emptyHint")}
              >
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("decks.optionsNamed", { name: deck.name })}
              onClick={(e) => {
                e.stopPropagation();
                onOptions();
              }}
              title={t("decks.options")}
            >
              <Settings className="size-4" />
            </Button>
          )}
          <DeckActionsMenu
            deck={deck}
            onStudy={onStudy}
            onRename={() => setRenaming(true)}
            onIncreaseLimit={() => setLimitOpen((o) => !o)}
            onOptions={onOptions}
            onCheckQuality={onCheckQuality}
            onResetProgress={onResetProgress}
            onExport={onExport}
            onDelete={onDelete}
            onRebuild={onRebuild}
            onEmpty={onEmpty}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {limitOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: dur.fast, ease }}
            className="overflow-hidden"
            style={{ paddingInlineStart: `${2 + depth * 1.25}rem` }}
          >
            <div className="px-8 py-3">
              <IncreaseLimitControl
                deckId={deck.id}
                hasChildren={hasChildren}
                onDone={() => setLimitOpen(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
