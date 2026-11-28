import { ChevronLeft, ChevronRight } from "lucide-react";
import { CardFace } from "@/components/CardFace";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

interface TemplatePreviewPaneProps {
  questionHtml: string;
  answerHtml: string;
  css: string;
  tauri: boolean;
  night: boolean;
  bottomSpacing?: boolean;
  noteIndex?: number;
  noteCount?: number;
  onPrevNote?: () => void;
  onNextNote?: () => void;
  isImported?: boolean;
}

/** Shared Front/Back CardFace preview column used by Templates and Styling tabs. */
export function TemplatePreviewPane({
  questionHtml,
  answerHtml,
  css,
  tauri,
  night,
  bottomSpacing = false,
  noteIndex = 0,
  noteCount = 0,
  onPrevNote,
  onNextNote,
  isImported = false,
}: TemplatePreviewPaneProps) {
  return (
    <div className="flex w-1/2 flex-col overflow-auto p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t("notetypes.preview")}</span>
        {noteCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{t("notetypes.previewNoteOf", { n: noteIndex + 1, total: noteCount })}</span>
            {noteCount > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={noteIndex <= 0}
                  onClick={onPrevNote}
                  aria-label={t("notetypes.previewPrevNote")}
                >
                  <ChevronLeft className="size-3.5 rtl:rotate-180" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={noteIndex >= noteCount - 1}
                  onClick={onNextNote}
                  aria-label={t("notetypes.previewNextNote")}
                >
                  <ChevronRight className="size-3.5 rtl:rotate-180" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {isImported && (
        <div className="mb-2 rounded border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
          {t("notetypes.importedNotice")}
        </div>
      )}
      <div className={bottomSpacing ? "mb-3 space-y-1" : "space-y-1"}>
        <div className="rounded border border-border bg-card p-3">
          <div className="mb-1 text-xs text-muted-foreground">{t("notetypes.front")}</div>
          <CardFace html={questionHtml} css={css} tauri={tauri} night={night} className="text-sm" />
        </div>
        <div className="rounded border border-border bg-card p-3">
          <div className="mb-1 text-xs text-muted-foreground">{t("notetypes.back")}</div>
          <CardFace html={answerHtml} css={css} tauri={tauri} night={night} className="text-sm" />
        </div>
      </div>
    </div>
  );
}
