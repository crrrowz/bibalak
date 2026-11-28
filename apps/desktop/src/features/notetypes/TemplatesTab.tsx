import { Plus, Trash2 } from "lucide-react";
import type { NotetypeDetail, TemplateSummary } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { TemplatePreviewPane } from "@/features/notetypes/TemplatePreviewPane";
import { t, tn } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";

interface TemplatesTabProps {
  nt: NotetypeDetail;
  template: TemplateSummary | undefined;
  selectedTemplateOrd: number;
  tmplName: string;
  tmplQfmt: string;
  tmplAfmt: string;
  cssDraft: string;
  previewQuestion: string;
  previewAnswer: string;
  tauri: boolean;
  night: boolean;
  isSaving: boolean;
  noteIndex?: number;
  noteCount?: number;
  onPrevNote?: () => void;
  onNextNote?: () => void;
  onSelectTemplate: (ord: number) => void;
  onAddTemplate: () => void;
  onRemoveTemplate: (ord: number) => void;
  onChangeName: (v: string) => void;
  onChangeQfmt: (v: string) => void;
  onChangeAfmt: (v: string) => void;
  onSaveTemplate: (ord: number) => void;
  onRequestConfirm: (opts: { title: string; description: string; onConfirm: () => void }) => void;
}

/** Card template selector, front/back template editor, and shared live CardFace preview. */
export function TemplatesTab({
  nt,
  template,
  selectedTemplateOrd,
  tmplName,
  tmplQfmt,
  tmplAfmt,
  cssDraft,
  previewQuestion,
  previewAnswer,
  tauri,
  night,
  isSaving,
  noteIndex = 0,
  noteCount = 0,
  onPrevNote,
  onNextNote,
  onSelectTemplate,
  onAddTemplate,
  onRemoveTemplate,
  onChangeName,
  onChangeQfmt,
  onChangeAfmt,
  onSaveTemplate,
  onRequestConfirm,
}: TemplatesTabProps) {
  return (
    <div
      id="notetype-panel-templates"
      role="tabpanel"
      aria-labelledby="notetype-tab-templates"
      className="flex min-w-0 flex-1 overflow-hidden"
    >
      {/* Template selector */}
      <div className="flex w-48 shrink-0 flex-col border-e border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("notetypes.cards")}
          </span>
          {Number(nt.kind) === 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={onAddTemplate}
              aria-label={t("notetypes.addTemplate")}
              title={t("notetypes.addTemplate")}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
        {nt.templates.map((tmpl) => {
          const tOrd = Number(tmpl.ord);
          return (
            <div
              key={tOrd}
              className={[
                "flex items-center justify-between px-3 py-2 text-start text-sm transition-colors",
                selectedTemplateOrd === tOrd
                  ? "bg-sidebar-accent font-medium text-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onSelectTemplate(tOrd)}
                className="flex-1 truncate text-start"
              >
                {tmpl.name}
              </button>
              {nt.templates.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ms-1 size-6 text-muted-foreground hover:text-destructive"
                  aria-label={t("notetypes.template.delete")}
                  title={t("notetypes.template.delete")}
                  onClick={async () => {
                    const cardsDeleted = await ipc.checkTemplateRemove(nt.id, tOrd);
                    onRequestConfirm({
                      title: t("notetypes.template.delete"),
                      description: tn("notetypes.deleteTemplateConfirmCards", cardsDeleted, {
                        name: tmpl.name,
                        count: cardsDeleted,
                      }),
                      onConfirm: () => onRemoveTemplate(tOrd),
                    });
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Template editor + preview */}
      {template && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex w-1/2 flex-col gap-3 overflow-auto border-e border-border p-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("notetypes.templateName")}
                </label>
                <input
                  className="w-full rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                  value={tmplName}
                  onChange={(e) => onChangeName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("notetypes.frontTemplate")}
                </label>
                <textarea
                  dir="ltr"
                  className="h-28 w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={tmplQfmt}
                  onChange={(e) => onChangeQfmt(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("notetypes.backTemplate")}
                </label>
                <textarea
                  dir="ltr"
                  className="h-28 w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={tmplAfmt}
                  onChange={(e) => onChangeAfmt(e.target.value)}
                />
              </div>

              <Button
                size="sm"
                className="w-fit"
                onClick={() => onSaveTemplate(Number(template.ord))}
                disabled={isSaving}
              >
                {isSaving ? t("common.saving") : t("common.save")}
              </Button>
            </div>

            <TemplatePreviewPane
              questionHtml={previewQuestion}
              answerHtml={previewAnswer}
              css={cssDraft}
              tauri={tauri}
              night={night}
              bottomSpacing
              noteIndex={noteIndex}
              noteCount={noteCount}
              onPrevNote={onPrevNote}
              onNextNote={onNextNote}
              isImported={nt.preset === null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
