import { useCallback, useEffect, useMemo } from "react";
import { Sparkles, X } from "lucide-react";
import type { AIActionRequest, AIActionResult } from "@bibalak/ipc-types";
import {
  AINotConfiguredContent,
  AIPreviewBody,
  AIResultBox,
  AISendingBox,
} from "@/components/ai/AIBlocks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAiActionRunner } from "@/hooks/useAiActionRunner";
import { t } from "@/lib/i18n";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";

export interface AIActionDialogProps {
  open: boolean;
  title: string;
  action: AIActionRequest | null;
  /** Whether AI has an enabled provider + required credentials; defaults true when omitted. */
  configured?: boolean;
  acceptLabel?: string;
  onAccept?: (result: AIActionResult) => void;
  onSetupAI?: () => void;
  onClose: () => void;
}

export function AIActionDialog({
  open,
  title,
  action,
  configured = true,
  acceptLabel,
  onAccept,
  onSetupAI,
  onClose,
}: AIActionDialogProps) {
  const navigate = useOptionalNavigate();
  const runner = useAiActionRunner(configured);

  const actionKey = action ? JSON.stringify(action) : null;
  const stableAction = useMemo(
    () => (actionKey ? (JSON.parse(actionKey) as AIActionRequest) : null),
    [actionKey],
  );

  const { trigger, reset } = runner;

  useEffect(() => {
    if (!open || !stableAction) {
      reset();
      return;
    }
    trigger(stableAction);
  }, [open, stableAction, trigger, reset]);

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

  const canSkipPreview =
    stableAction != null && stableAction.kind !== "test-connection" && runner.phase === "preview";

  return (
    <Dialog
      open={open && Boolean(action)}
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

      {runner.phase === "not-configured" ? (
        <AINotConfiguredContent onCancel={handleClose} onSetup={handleSetupAI} />
      ) : (
        <>
          {runner.phase === "loading-preview" || runner.phase === "preview" ? (
            <p className="mb-3 text-xs text-muted-foreground">{t("ai.plainTextNotice")}</p>
          ) : null}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
            {runner.phase === "loading-preview" && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Spinner />
                <span>{t("ai.loadingPreview")}</span>
              </div>
            )}

            {runner.phase === "preview" && runner.preview && (
              <AIPreviewBody preview={runner.preview} />
            )}

            {canSkipPreview && (
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

            {runner.phase === "sending" && <AISendingBox />}

            {runner.phase === "error" && runner.error && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              >
                {runner.error.message}
              </div>
            )}

            {runner.phase === "result" && runner.result && <AIResultBox result={runner.result} />}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            {(runner.phase === "loading-preview" ||
              runner.phase === "preview" ||
              runner.phase === "sending") && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
            )}
            {(runner.phase === "result" || runner.phase === "error") && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                {t("common.close")}
              </Button>
            )}
            {runner.phase === "preview" && (
              <Button type="button" size="sm" onClick={runner.confirmSend}>
                {t("ai.send")}
              </Button>
            )}
            {runner.phase === "error" && runner.error?.kind === "not-configured" && (
              <Button type="button" size="sm" onClick={handleSetupAI}>
                {t("ai.notConfigured.setupButton")}
              </Button>
            )}
            {runner.phase === "error" && runner.error?.kind !== "not-configured" && (
              <Button type="button" variant="outline" size="sm" onClick={runner.retry}>
                {t("common.retry")}
              </Button>
            )}
            {runner.phase === "result" && runner.result && onAccept && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (runner.result) onAccept(runner.result);
                  handleClose();
                }}
              >
                {acceptLabel ?? t("ai.accept")}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
