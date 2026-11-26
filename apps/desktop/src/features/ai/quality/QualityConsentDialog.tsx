import { Sparkles, X } from "lucide-react";
import type { AIPreviewPayload, QualityNoteInput } from "@bibalak/ipc-types";
import { AIPreviewBody } from "@/components/ai/AIBlocks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t, tn } from "@/lib/i18n";

export interface QualityConsentDialogProps {
  open: boolean;
  chunks: QualityNoteInput[][];
  preview: AIPreviewPayload | null;
  skipSession: boolean;
  onChangeSkipSession: (next: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function QualityConsentDialog({
  open,
  chunks,
  preview,
  skipSession,
  onChangeSkipSession,
  onConfirm,
  onCancel,
}: QualityConsentDialogProps) {
  return (
    <Dialog
      open={open && Boolean(preview)}
      onClose={onCancel}
      ariaLabel={t("ai.quality.consentTitle")}
      className="flex max-h-[85vh] max-w-2xl flex-col rounded-[14px] p-6"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-base font-semibold">{t("ai.quality.consentTitle")}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </Button>
      </div>

      {preview && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
          <p className="text-xs text-muted-foreground">
            {tn("ai.quality.partsCount", chunks.length)}
          </p>
          <p className="text-xs text-muted-foreground">{t("ai.plainTextNotice")}</p>
          <AIPreviewBody preview={preview} />
          {chunks.length > 1 && (
            <ul className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              {chunks.slice(1).map((chunk, idx) => {
                const chars = chunk.reduce(
                  (acc, note) => acc + note.fields.reduce((s, f) => s + f.value_html.length, 0),
                  0,
                );
                return (
                  <li key={idx + 2}>
                    {t("ai.quality.partLine", {
                      index: idx + 2,
                      count: chunk.length,
                      chars,
                    })}
                  </li>
                );
              })}
            </ul>
          )}
          <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={skipSession}
              onChange={(e) => onChangeSkipSession(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            <span>{t("ai.dontAskSession")}</span>
          </label>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={onConfirm}>
          {t("ai.send")}
        </Button>
      </div>
    </Dialog>
  );
}
