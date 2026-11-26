import { Button } from "@/components/ui/button";
import { TemplatePreviewPane } from "@/features/notetypes/TemplatePreviewPane";
import { t } from "@/lib/i18n";

interface StylingTabProps {
  cssDraft: string;
  previewQuestion: string;
  previewAnswer: string;
  tauri: boolean;
  night: boolean;
  isSaving: boolean;
  onChangeCss: (css: string) => void;
  onSaveCss: () => void;
}

/** Shared CSS editor with live Front/Back CardFace preview. */
export function StylingTab({
  cssDraft,
  previewQuestion,
  previewAnswer,
  tauri,
  night,
  isSaving,
  onChangeCss,
  onSaveCss,
}: StylingTabProps) {
  return (
    <div
      id="notetype-panel-styling"
      role="tabpanel"
      aria-labelledby="notetype-tab-styling"
      className="flex min-w-0 flex-1 overflow-hidden"
    >
      <div className="flex w-1/2 flex-col gap-3 overflow-auto border-e border-border p-4">
        <label htmlFor="notetype-card-css" className="text-xs font-medium text-muted-foreground">
          {t("notetypes.cardCss")}
        </label>
        <textarea
          id="notetype-card-css"
          dir="ltr"
          className="h-full min-h-64 w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          value={cssDraft}
          onChange={(e) => onChangeCss(e.target.value)}
          spellCheck={false}
        />
        <Button size="sm" className="w-fit" onClick={onSaveCss} disabled={isSaving}>
          {isSaving ? t("common.saving") : t("common.save")}
        </Button>
      </div>

      <TemplatePreviewPane
        questionHtml={previewQuestion}
        answerHtml={previewAnswer}
        css={cssDraft}
        tauri={tauri}
        night={night}
      />
    </div>
  );
}
