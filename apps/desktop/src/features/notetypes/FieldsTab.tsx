import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { FieldDirection, FieldOptions, NotetypeDetail } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { fieldNameProblem } from "@/lib/fieldName";
import { t, tn } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";

const EMPTY_FIELD_OPTIONS: FieldOptions = {
  direction: "auto",
  font: "",
  size: 0,
  description: "",
};

interface FieldsTabProps {
  nt: NotetypeDetail;
  onSetSortField: (ord: number) => void;
  onMoveField: (ord: number, direction: -1 | 1) => void;
  onRenameField: (ord: number, name: string) => void;
  onRemoveField: (ord: number) => void;
  onSaveFieldOptions: (ord: number, options: FieldOptions) => void;
  onAddField: () => void;
  onValidationError: (message: string) => void;
  onRequestConfirm: (opts: { title: string; description: string; onConfirm: () => void }) => void;
}

/** Field ordering, inline rename, per-field RTL/font options, and removal checks. */
export function FieldsTab({
  nt,
  onSetSortField,
  onMoveField,
  onRenameField,
  onRemoveField,
  onSaveFieldOptions,
  onAddField,
  onValidationError,
  onRequestConfirm,
}: FieldsTabProps) {
  return (
    <div
      id="notetype-panel-fields"
      role="tabpanel"
      aria-labelledby="notetype-tab-fields"
      className="flex w-full flex-col gap-2.5 overflow-auto p-4"
    >
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <label htmlFor="notetype-sort-field" className="text-xs font-medium text-muted-foreground">
          {t("notetypes.sortField")}
        </label>
        <Select
          id="notetype-sort-field"
          selectSize="sm"
          containerClassName="w-auto"
          className="text-sm"
          value={Number(nt.sort_field ?? 0)}
          onChange={(e) => onSetSortField(Number(e.target.value))}
        >
          {nt.fields.map((f) => (
            <option key={`${nt.id}:sort:${Number(f.ord)}`} value={Number(f.ord)}>
              {f.name}
            </option>
          ))}
        </Select>
      </div>

      {nt.fields.map((field) => {
        const fieldOrd = Number(field.ord);
        const opts = field.options ?? EMPTY_FIELD_OPTIONS;
        return (
          <div
            key={`${nt.id}:field:${field.name}`}
            className="rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => onMoveField(fieldOrd, -1)}
                  disabled={fieldOrd === 0}
                  aria-label={t("notetypes.field.moveUp")}
                  title={t("notetypes.field.moveUp")}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMoveField(fieldOrd, 1)}
                  disabled={fieldOrd === nt.fields.length - 1}
                  aria-label={t("notetypes.field.moveDown")}
                  title={t("notetypes.field.moveDown")}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>

              <input
                key={`${nt.id}:${field.name}:${fieldOrd}`}
                className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none hover:border-input focus:border-ring focus:ring-1 focus:ring-ring"
                defaultValue={field.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name === field.name) return;
                  const problem = fieldNameProblem(
                    name,
                    nt.fields.filter((f) => Number(f.ord) !== fieldOrd).map((f) => f.name),
                  );
                  if (problem) {
                    onValidationError(t(`notetypes.fieldName.${problem}`));
                    e.target.value = field.name;
                    return;
                  }
                  onRenameField(fieldOrd, name);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    e.currentTarget.value = field.name;
                    e.currentTarget.blur();
                  }
                }}
              />

              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                aria-label={t("notetypes.field.delete")}
                title={t("notetypes.field.delete")}
                onClick={async () => {
                  const warn = await ipc.checkFieldRemove(nt.id, fieldOrd);
                  let desc = "";
                  if (warn.using_templates && warn.using_templates.length > 0) {
                    desc = `${t("notetypes.fieldUsedInTemplates", {
                      templates: warn.using_templates.join(", "),
                    })}\n\n`;
                  }
                  if (warn.notes_with_content > 0) {
                    desc += tn("notetypes.fieldInUse", warn.notes_with_content);
                  }
                  if (desc) {
                    onRequestConfirm({
                      title: t("notetypes.field.delete"),
                      description: desc,
                      onConfirm: () => onRemoveField(fieldOrd),
                    });
                  } else {
                    onRemoveField(fieldOrd);
                  }
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 border-t border-border/60 pt-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("notetypes.field.direction")}
                </span>
                <Select
                  selectSize="xs"
                  aria-label={`${t("notetypes.field.direction")}: ${field.name}`}
                  value={opts.direction}
                  onChange={(e) =>
                    onSaveFieldOptions(fieldOrd, {
                      ...opts,
                      direction: e.target.value as FieldDirection,
                    })
                  }
                >
                  <option value="auto">{t("notetypes.field.direction.auto")}</option>
                  <option value="rtl">{t("notetypes.field.direction.rtl")}</option>
                  <option value="ltr">{t("notetypes.field.direction.ltr")}</option>
                </Select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("notetypes.field.font")}
                </span>
                <input
                  key={`${nt.id}:font:${fieldOrd}:${opts.font}`}
                  type="text"
                  aria-label={`${t("notetypes.field.font")}: ${field.name}`}
                  defaultValue={opts.font}
                  placeholder={t("notetypes.field.fontPlaceholder")}
                  onBlur={(e) => {
                    const font = e.target.value.trim();
                    if (font === opts.font) return;
                    onSaveFieldOptions(fieldOrd, { ...opts, font });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.currentTarget.value = opts.font;
                      e.currentTarget.blur();
                    }
                  }}
                  className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("notetypes.field.size")}
                </span>
                <input
                  key={`${nt.id}:size:${fieldOrd}:${opts.size}`}
                  type="number"
                  min={0}
                  max={200}
                  aria-label={`${t("notetypes.field.size")}: ${field.name}`}
                  defaultValue={opts.size > 0 ? String(opts.size) : ""}
                  placeholder={t("notetypes.field.sizePlaceholder")}
                  onBlur={(e) => {
                    const raw = Number(e.target.value.trim() || "0");
                    const size =
                      Number.isFinite(raw) && raw > 0 ? Math.min(200, Math.round(raw)) : 0;
                    if (size === opts.size) return;
                    onSaveFieldOptions(fieldOrd, { ...opts, size });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.currentTarget.value = opts.size > 0 ? String(opts.size) : "";
                      e.currentTarget.blur();
                    }
                  }}
                  className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("notetypes.field.description")}
                </span>
                <input
                  key={`${nt.id}:desc:${fieldOrd}:${opts.description}`}
                  type="text"
                  aria-label={`${t("notetypes.field.description")}: ${field.name}`}
                  defaultValue={opts.description}
                  placeholder={t("notetypes.field.descriptionPlaceholder")}
                  onBlur={(e) => {
                    const description = e.target.value.trim();
                    if (description === opts.description) return;
                    onSaveFieldOptions(fieldOrd, { ...opts, description });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.currentTarget.value = opts.description;
                      e.currentTarget.blur();
                    }
                  }}
                  className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
            </div>
          </div>
        );
      })}

      <Button variant="outline" size="sm" className="mt-1 w-fit" onClick={onAddField}>
        <Plus className="me-1.5 size-3.5" />
        {t("notetypes.addField")}
      </Button>
    </div>
  );
}
