import { useState } from "react";
import { Filter, Layers, Play, RefreshCw, Settings, X } from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { DeckCounts } from "./DeckCounts";
import { DeckActionsMenu } from "./DeckActionsMenu";
import { IncreaseLimitControl } from "./IncreaseLimitControl";
import { t } from "@/lib/i18n";

function deckLabel(name: string): string {
  const parts = name.split("::");
  return parts[parts.length - 1];
}

function deckParentPath(name: string): string | null {
  const parts = name.split("::");
  return parts.length > 1 ? parts.slice(0, -1).join(" / ") : null;
}

/** Ring showing today's queue composition (new / learning / review share). */
function QueueRing({ deck }: { deck: DeckSummary }) {
  const total = deck.new_count + deck.learning_count + deck.review_count;
  const r = 15;
  const c = 2 * Math.PI * r;
  if (total === 0) {
    return (
      <svg width={36} height={36} viewBox="0 0 36 36" className="shrink-0">
        <circle cx={18} cy={18} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={4} />
      </svg>
    );
  }
  const segs = [
    { count: deck.new_count, color: "hsl(213 68% 50%)" },
    { count: deck.learning_count, color: "hsl(38 92% 50%)" },
    { count: deck.review_count, color: "hsl(142 71% 45%)" },
  ];
  let offset = 0;
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" className="shrink-0 -rotate-90">
      <circle cx={18} cy={18} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={4} />
      {segs.map((s, i) => {
        const frac = s.count / total;
        const dash = frac * c;
        const el = (
          <circle
            key={i}
            cx={18}
            cy={18}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={4}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

export function DeckGridCard({
  deck,
  hasChildren = false,
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
  hasChildren?: boolean;
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
  const total = deck.new_count + deck.learning_count + deck.review_count;
  const parentPath = deckParentPath(deck.name);

  function submitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed && trimmed !== deck.name) onRename(trimmed);
    else setRenameValue(deck.name);
  }

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {deck.is_filtered ? (
            <Filter className="size-4 shrink-0 text-purple-500" />
          ) : (
            <Layers className="size-4 shrink-0 text-muted-foreground" />
          )}
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") {
                  setRenameValue(deck.name);
                  setRenaming(false);
                }
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div className="min-w-0 flex-1">
              {parentPath && (
                <p
                  data-testid="deck-grid-parent"
                  className="truncate text-[11px] text-muted-foreground"
                >
                  {parentPath}
                </p>
              )}
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{deckLabel(deck.name)}</span>
                {hasChildren && (
                  <span
                    className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title={t("decks.rolledUpHint")}
                  >
                    {t("decks.includesSubdecks")}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {deck.is_filtered ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("decks.rebuildNamed", { name: deck.name })}
                onClick={onRebuild}
                title={t("decks.rebuildFiltered")}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("decks.emptyNamed", { name: deck.name })}
                onClick={onEmpty}
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
              onClick={onOptions}
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

      <div className="flex items-center justify-between gap-3">
        <QueueRing deck={deck} />
        <DeckCounts
          newCount={deck.new_count}
          learningCount={deck.learning_count}
          reviewCount={deck.review_count}
          showLabels
        />
      </div>

      {limitOpen && (
        <IncreaseLimitControl
          deckId={deck.id}
          hasChildren={hasChildren}
          onDone={() => setLimitOpen(false)}
        />
      )}

      <Button size="sm" variant={total > 0 ? "default" : "outline"} onClick={onStudy}>
        <Play className="size-3.5" /> {t("decks.study")}
      </Button>
    </div>
  );
}
