import { Loader2 } from "lucide-react";
import type { AIActionResult, AIPreviewPayload } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export function AINotConfiguredContent({
  onCancel,
  onSetup,
}: {
  onCancel: () => void;
  onSetup: () => void;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 text-sm">
        <p className="font-medium text-foreground">{t("ai.notConfigured.title")}</p>
        <p className="text-muted-foreground">{t("ai.notConfigured.description")}</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={onSetup}>
          {t("ai.notConfigured.setupButton")}
        </Button>
      </div>
    </>
  );
}

export function AIPreviewBody({ preview }: { preview: AIPreviewPayload }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
        <span className="flex flex-wrap items-center gap-1">
          <span>{t("ai.destination")}:</span>
          <strong className="font-mono text-foreground">
            <bdi dir="ltr">{preview.endpoint_origin}</bdi>
          </strong>
        </span>
        <bdi className="font-mono" dir="ltr">
          {preview.model}
        </bdi>
      </div>
      {preview.system && (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">{t("ai.systemLabel")}</div>
          <div dir="auto" className="whitespace-pre-wrap text-foreground/85">
            {preview.system}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 font-medium text-muted-foreground">{t("ai.payloadLabel")}</div>
        <pre
          dir="auto"
          className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 font-sans text-xs text-foreground"
        >
          {preview.prompt}
        </pre>
      </div>
    </div>
  );
}

export function AISendingBox() {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-xs">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        <span>{t("ai.sending")}</span>
      </div>
      <p className="text-muted-foreground">{t("ai.sendingHint")}</p>
    </div>
  );
}

export function AIResultBox({ result }: { result: AIActionResult }) {
  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-foreground">
        <span>{t("ai.resultLabel")}</span>
        {result.prompt_id && (
          <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
            {result.prompt_id}
          </span>
        )}
      </div>
      <pre dir="auto" className="whitespace-pre-wrap font-sans text-sm text-foreground">
        {result.suggested_fields ? result.suggested_fields.join("\n\n") : result.text}
      </pre>
      {result.input_tokens != null && result.output_tokens != null && (
        <div className="text-[11px] text-muted-foreground">
          {t("ai.tokens", {
            input: result.input_tokens,
            output: result.output_tokens,
          })}
        </div>
      )}
    </div>
  );
}
