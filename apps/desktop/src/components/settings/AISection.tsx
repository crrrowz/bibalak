import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { AISetupForm } from "@/components/ai/AISetupForm";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";

/** Settings section for configuring the AI provider and opening the Assistant hub (`/assistant`). */
export function AISection({ onOpenHub }: { onOpenHub?: () => void }) {
  const navigate = useOptionalNavigate();
  const cfg = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: ipc.aiGetConfig,
  }).data;

  const providerLabel =
    cfg?.provider === "ollama" ? t("ai.settings.providerOllama") : t("ai.settings.providerOpenAi");
  const statusLabel = cfg?.enabled ? t("ai.hub.status.enabled") : t("ai.hub.status.off");

  return (
    <section id="ai-assistant" className="mt-8 max-w-xl space-y-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="text-sm font-medium">{t("ai.settings.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("ai.settings.description")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4">
        <div className="space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            <span>{statusLabel}</span>
            {cfg && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>{providerLabel}</span>
                {cfg.model && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono" dir="ltr">
                      {cfg.model}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {cfg && (
            <div className="text-muted-foreground">
              {t("ai.hub.status.keyStored")}:{" "}
              {cfg.has_api_key ? t("ai.hub.status.keyYes") : t("ai.hub.status.keyNo")}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (onOpenHub) onOpenHub();
            else navigate?.("/assistant");
          }}
        >
          {t("ai.settings.openHub")}
          <ArrowUpRight className="ms-1.5 size-3.5 rtl:-scale-x-100" aria-hidden />
        </Button>
      </div>

      <div className="rounded-[14px] border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{t("ai.hub.setupTitle")}</h3>
        <AISetupForm />
      </div>
    </section>
  );
}
