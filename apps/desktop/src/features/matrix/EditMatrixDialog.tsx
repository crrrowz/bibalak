import { useId, useState } from "react";
import type {
  DeckSummary,
  MatrixDateFilter,
  MatrixItemType,
  MatrixListFilter,
  MatrixQuadrantDto,
  QuadrantKey,
  TaskListDto,
  TaskPriority,
} from "@bibalak/ipc-types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import { quadrantRoman, type AsyncHandler } from "./matrixHelpers";

const DATE_FILTERS: readonly MatrixDateFilter[] = [
  "no_date",
  "overdue",
  "today",
  "tomorrow",
  "next7_days",
  "this_month",
];

const PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low", "none"];
const ITEM_TYPES: readonly MatrixItemType[] = ["task", "deck_due"];

interface EditMatrixDialogProps {
  open: boolean;
  quadrant: MatrixQuadrantDto;
  taskLists: TaskListDto[];
  decks: DeckSummary[];
  onSave: AsyncHandler<[MatrixQuadrantDto]>;
  onRestoreDefaults: AsyncHandler<[QuadrantKey]>;
  onClose: () => void;
}

export function EditMatrixDialog({
  open,
  quadrant,
  taskLists,
  decks,
  onSave,
  onRestoreDefaults,
  onClose,
}: EditMatrixDialogProps) {
  const titleId = useId();
  const nameInputId = useId();
  const listsSelectId = useId();

  const [title, setTitle] = useState(quadrant.title);
  const [listMode, setListMode] = useState<MatrixListFilter["mode"]>(quadrant.rule.lists.mode);
  const [customListIds, setCustomListIds] = useState<string[]>(
    quadrant.rule.lists.mode === "custom" ? quadrant.rule.lists.list_ids : [],
  );
  const [customDeckIds, setCustomDeckIds] = useState<number[]>(
    quadrant.rule.lists.mode === "custom" ? quadrant.rule.lists.deck_ids : [],
  );
  const [dateAll, setDateAll] = useState(quadrant.rule.date_filters === null);
  const [selectedDates, setSelectedDates] = useState<MatrixDateFilter[]>(
    quadrant.rule.date_filters ?? [...DATE_FILTERS],
  );
  const [priorityAll, setPriorityAll] = useState(quadrant.rule.priorities === null);
  const [selectedPriorities, setSelectedPriorities] = useState<TaskPriority[]>(
    quadrant.rule.priorities ?? [...PRIORITIES],
  );
  const [typeAll, setTypeAll] = useState(quadrant.rule.types === null);
  const [selectedTypes, setSelectedTypes] = useState<MatrixItemType[]>(
    quadrant.rule.types ?? [...ITEM_TYPES],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleItem = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const lists: MatrixListFilter =
        listMode === "custom"
          ? { mode: "custom", list_ids: customListIds, deck_ids: customDeckIds }
          : { mode: listMode };
      await onSave({
        ...quadrant,
        title,
        rule: {
          lists,
          date_filters: dateAll ? null : selectedDates,
          priorities: priorityAll ? null : selectedPriorities,
          types: typeAll ? null : selectedTypes,
          pinned_deck_ids: quadrant.rule.pinned_deck_ids ?? [],
          excluded_deck_ids: quadrant.rule.excluded_deck_ids ?? [],
        },
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    setError(null);
    setSaving(true);
    try {
      await onRestoreDefaults(quadrant.quadrant_key);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const dateLabelKey = (d: MatrixDateFilter): LocaleKey => `matrix.editDialog.date.${d}`;
  const priorityLabelKey = (p: TaskPriority): LocaleKey => `matrix.priority.${p}`;
  const typeLabelKey = (tp: MatrixItemType): LocaleKey => `matrix.editDialog.type.${tp}`;

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy={titleId} className="max-w-lg">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {t("matrix.editDialog.title", { roman: quadrantRoman(quadrant.quadrant_key) })}
          </h2>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={nameInputId} className="block text-xs font-medium text-foreground">
            {t("matrix.editDialog.nameLabel")}
          </label>
          <input
            id={nameInputId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("matrix.editDialog.namePlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={listsSelectId} className="block text-xs font-medium text-foreground">
            {t("matrix.editDialog.listsLabel")}
          </label>
          <Select
            id={listsSelectId}
            value={listMode}
            onChange={(e) => setListMode(e.target.value as MatrixListFilter["mode"])}
          >
            <option value="all">{t("matrix.editDialog.listsAll")}</option>
            <option value="inbox">{t("matrix.editDialog.listsInbox")}</option>
            <option value="tasks">{t("matrix.editDialog.listsTasks")}</option>
            <option value="custom">{t("matrix.editDialog.listsCustom")}</option>
          </Select>

          {listMode === "custom" && (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-xs">
              {taskLists.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">
                    {t("matrix.editDialog.customListsHeading")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {taskLists.map((list) => (
                      <label key={list.id} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={customListIds.includes(list.id)}
                          onChange={() => setCustomListIds((prev) => toggleItem(prev, list.id))}
                        />
                        <span>{list.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {decks.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">
                    {t("matrix.editDialog.customDecksHeading")}
                  </p>
                  <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                    {decks
                      .filter((d) => !d.is_filtered)
                      .map((deck) => (
                        <label key={deck.id} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={customDeckIds.includes(deck.id)}
                            onChange={() => setCustomDeckIds((prev) => toggleItem(prev, deck.id))}
                          />
                          <span>{deck.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-foreground">
            {t("matrix.editDialog.dateLabel")}
          </legend>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={dateAll}
                onChange={(e) => setDateAll(e.target.checked)}
              />
              <span>{t("matrix.editDialog.dateAll")}</span>
            </label>
            {!dateAll &&
              DATE_FILTERS.map((df) => (
                <label key={df} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={selectedDates.includes(df)}
                    onChange={() => setSelectedDates((prev) => toggleItem(prev, df))}
                  />
                  <span>{t(dateLabelKey(df))}</span>
                </label>
              ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-foreground">
            {t("matrix.editDialog.priorityLabel")}
          </legend>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={priorityAll}
                onChange={(e) => setPriorityAll(e.target.checked)}
              />
              <span>{t("matrix.editDialog.priorityAll")}</span>
            </label>
            {!priorityAll &&
              PRIORITIES.map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={selectedPriorities.includes(p)}
                    onChange={() => setSelectedPriorities((prev) => toggleItem(prev, p))}
                  />
                  <span>{t(priorityLabelKey(p))}</span>
                </label>
              ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-foreground">
            {t("matrix.editDialog.typeLabel")}
          </legend>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={typeAll}
                onChange={(e) => setTypeAll(e.target.checked)}
              />
              <span>{t("matrix.editDialog.typeAll")}</span>
            </label>
            {!typeAll &&
              ITEM_TYPES.map((tp) => (
                <label key={tp} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(tp)}
                    onChange={() => setSelectedTypes((prev) => toggleItem(prev, tp))}
                  />
                  <span>{t(typeLabelKey(tp))}</span>
                </label>
              ))}
          </div>
        </fieldset>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => void handleRestore()}
          >
            {t("matrix.editDialog.restoreDefaults")}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              {t("matrix.editDialog.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {t("matrix.editDialog.save")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
