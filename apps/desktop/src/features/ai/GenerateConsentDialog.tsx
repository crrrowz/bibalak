import type { AIPreviewPayload } from "@bibalak/ipc-types";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t, tn } from "@/lib/i18n";

export interface ConsentState {
  parts: string[];
  counts: number[];
  preview: AIPreviewPayload;
  skipSession: boolean;
}

interface GenerateConsentDialogProps {
  consent: ConsentState | null;
  onClose: () => void;
  onSkipSessionChange: (skip: boolean) => void;
  onConfirmSend: () => void;
}

export function GenerateConsentDialog({
  consent,
  onClose,
  onSkipSessionChange,
  onConfirmSend,
}: GenerateConsentDialogProps) {
  return (
    <Dialog
      open={Boolean(consent)}
      onClose={onClose}
      ariaLabel={t("ai.generate.partsPreviewTitle")}
      className="flex max-h-[85vh] max-w-lg flex-col rounded-[14px] p-6"
    >
      {consent && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 className="text-base font-semibold">{t("ai.generate.partsPreviewTitle")}</h2>
          </div>

          <p className="mb-3 text-xs font-medium text-foreground">
            {tn("ai.generate.partsNotice", consent.parts.length)}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">{t("ai.plainTextNotice")}</p>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <span className="flex flex-wrap items-center gap-1">
                  <span>{t("ai.destination")}:</span>
                  <strong className="font-mono text-foreground">
                    <bdi dir="ltr">{consent.preview.endpoint_origin}</bdi>
                  </strong>
                </span>
                <bdi className="font-mono" dir="ltr">
                  {consent.preview.model}
                </bdi>
              </div>

              {consent.preview.system && (
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">
                    {t("ai.systemLabel")}
                  </div>
                  <div dir="auto" className="whitespace-pre-wrap text-foreground/85">
                    {consent.preview.system}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 font-medium text-muted-foreground">{t("ai.payloadLabel")}</div>
                <pre
                  dir="auto"
                  className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 font-sans text-xs text-foreground"
                >
                  {consent.preview.prompt}
                </pre>
              </div>
            </div>

            {consent.parts.length > 1 && (
              <div className="space-y-1.5 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                <div className="font-medium text-muted-foreground">
                  {t("ai.generate.remainingPartsLabel")}
                </div>
                <ul className="space-y-1 text-foreground">
                  {consent.parts.slice(1).map((part, idx) => (
                    <li key={idx + 2}>
                      {t("ai.generate.partListing", {
                        index: idx + 2,
                        chars: part.length,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {consent.parts.length === 1 && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consent.skipSession}
                  onChange={(e) => onSkipSessionChange(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                <span>{t("ai.dontAskSession")}</span>
              </label>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" onClick={onConfirmSend}>
              {t("ai.send")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
