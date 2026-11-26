import { CardFace } from "@/components/CardFace";
import { t } from "@/lib/i18n";

interface TemplatePreviewPaneProps {
  questionHtml: string;
  answerHtml: string;
  css: string;
  tauri: boolean;
  night: boolean;
  bottomSpacing?: boolean;
}

/** Shared Front/Back CardFace preview column used by Templates and Styling tabs. */
export function TemplatePreviewPane({
  questionHtml,
  answerHtml,
  css,
  tauri,
  night,
  bottomSpacing = false,
}: TemplatePreviewPaneProps) {
  return (
    <div className="flex w-1/2 flex-col overflow-auto p-4">
      <span className="mb-2 text-xs font-medium text-muted-foreground">
        {t("notetypes.preview")}
      </span>
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
