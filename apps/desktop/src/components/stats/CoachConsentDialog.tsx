import { useCallback, useEffect, useMemo } from "react";
import { Sparkles, X } from "lucide-react";
import type { AIActionRequest, CoachInput, CoachReport } from "@bibalak/ipc-types";
import { AINotConfiguredContent, AIPreviewBody, AISendingBox } from "@/components/ai/AIBlocks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAiActionRunner } from "@/hooks/useAiActionRunner";
import { t } from "@/lib/i18n";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";

export interface CoachConsentDialogProps {
  open: boolean;
  input: CoachInput | null;
  configured?: boolean;
  onSuccess: (report: CoachReport) => void;
  onClose: () => void;
  onSetupAI?: () => void;
}

export function CoachConsentDialog({
  open,
  input,
  configured = true,
  onSuccess,
  onClose,
  onSetupAI,
}: CoachConsentDialogProps) {
  const navigate = useOptionalNavigate();
  const runner = useAiActionRunner(configured);

  const stableInputKey = input ? JSON.stringify(input) : null;
  const stableInput = useMemo(
    () => (stableInputKey ? (JSON.parse(stableInputKey) as CoachInput) : null),
    [stableInputKey],
  );

  const { trigger, reset, phase, result } = runner;

  useEffect(() => {
    if (!open || !stableInput) {
      reset();
      return;
    }
    const action: AIActionRequest = {
      kind: "study-coach",
      input: stableInput,
    };
    trigger(action);
  }, [open, stableInput, trigger, reset]);

  useEffect(() => {
    if (phase === "result" && result?.coach_report) {
      onSuccess(result.coach_report);
      reset();
      onClose();
    }
  }, [phase, result, onSuccess, onClose, reset]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSetupAI = useCallback(() => {
    reset();
    onClose();
    if (onSetupAI) {
      onSetupAI();
    } else {
      navigate?.("/assistant");
    }
  }, [navigate, onClose, onSetupAI, reset]);

  const title = t("ai.coach.panelTitle");

  return (
    <Dialog
      open={open && Boolean(input)}
      onClose={handleClose}
      ariaLabel={title}
      className="flex max-h-[85vh] max-w-lg flex-col rounded-[14px] p-6"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </Button>
      </div>

      {phase === "not-configured" ? (
        <AINotConfiguredContent onCancel={handleClose} onSetup={handleSetupAI} />
      ) : (
        <>
          {phase === "loading-preview" || phase === "preview" ? (
            <p className="mb-3 text-xs text-muted-foreground">{t("ai.coach.consentNotice")}</p>
          ) : null}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
            {phase === "loading-preview" && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Spinner />
                <span>{t("ai.loadingPreview")}</span>
              </div>
            )}

            {phase === "preview" && runner.preview && <AIPreviewBody preview={runner.preview} />}

            {phase === "preview" && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={runner.skipSession}
                  onChange={(e) => runner.setSkipSession(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                <span>{t("ai.dontAskSession")}</span>
              </label>
            )}

            {phase === "sending" && <AISendingBox />}

            {phase === "error" && runner.error && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              >
                {runner.error.message}
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            {(phase === "loading-preview" || phase === "preview" || phase === "sending") && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
            )}
            {phase === "error" && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                {t("common.close")}
              </Button>
            )}
            {phase === "preview" && (
              <Button type="button" size="sm" onClick={runner.confirmSend}>
                {t("ai.send")}
              </Button>
            )}
            {phase === "error" && runner.error?.kind === "not-configured" && (
              <Button type="button" size="sm" onClick={handleSetupAI}>
                {t("ai.notConfigured.setupButton")}
              </Button>
            )}
            {phase === "error" && runner.error?.kind !== "not-configured" && (
              <Button type="button" variant="outline" size="sm" onClick={runner.retry}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
