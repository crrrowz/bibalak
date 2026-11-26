import { useQuery } from "@tanstack/react-query";
import { Compass, FilePlus2, ShieldCheck, Sparkles } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";

const TOOLS = [
  {
    id: "quality",
    icon: ShieldCheck,
    titleKey: "ai.quality.hubTitle" as const,
    descKey: "ai.quality.description" as const,
    route: "/assistant/quality" as const,
    actionKey: "ai.quality.openReview" as const,
  },
  {
    id: "generate",
    icon: FilePlus2,
    titleKey: "ai.generate.title" as const,
    descKey: "ai.generate.description" as const,
    route: "/assistant/generate" as const,
    actionKey: "ai.generate.openGenerator" as const,
  },
  {
    id: "coach",
    icon: Compass,
    titleKey: "ai.coach.hubTitle" as const,
    descKey: "ai.coach.description" as const,
    route: "/stats" as const,
    actionKey: "ai.coach.openCoach" as const,
  },
];

const IN_SCREEN_HELPERS = [
  {
    id: "tutor",
    titleKey: "ai.tutor.hubTitle" as const,
    descKey: "ai.tutor.hubDesc" as const,
    whereKey: "ai.tutor.hubWhere" as const,
  },
  {
    id: "whyWrong",
    titleKey: "ai.tutor.whyWrong" as const,
    descKey: "ai.hub.inScreen.whyWrongDesc" as const,
    whereKey: "ai.tutor.hubWhere" as const,
  },
  {
    id: "explain",
    titleKey: "ai.action.explain" as const,
    descKey: "ai.hub.inScreen.explainDesc" as const,
    whereKey: "ai.hub.inScreen.explainWhere" as const,
  },
  {
    id: "rewrite",
    titleKey: "ai.action.rewriteLeech" as const,
    descKey: "ai.hub.cap.rewrite.desc" as const,
    whereKey: "ai.hub.cap.rewrite.where" as const,
  },
  {
    id: "suggest",
    titleKey: "ai.action.suggestBack" as const,
    descKey: "ai.hub.cap.suggest.desc" as const,
    whereKey: "ai.hub.cap.suggest.where" as const,
  },
];

export function AssistantScreen() {
  const navigate = useOptionalNavigate();
  const cfgQuery = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: ipc.aiGetConfig,
  });
  const cfg = cfgQuery.data;
  const aiEnabled = Boolean(cfg?.enabled);

  const providerLabel =
    cfg?.provider === "ollama" ? t("ai.settings.providerOllama") : t("ai.settings.providerOpenAi");

  const openAiSettings = () => {
    try {
      sessionStorage.setItem("keepsake-settings-category", "ai");
    } catch {
      // sessionStorage unavailable
    }
    navigate?.("/settings");
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("ai.hub.title")} description={t("ai.hub.description")} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
          {/* Compact setup status row */}
          <section
            aria-label={t("ai.hub.statusTitle")}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium ${
                  aiEnabled
                    ? "border-emerald-600/30 bg-emerald-500/10 text-foreground"
                    : "border-border bg-muted/60 text-muted-foreground"
                }`}
              >
                <Sparkles className="size-3 text-primary" aria-hidden />
                {aiEnabled ? t("ai.hub.status.enabled") : t("ai.hub.status.off")}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium text-foreground">{cfg ? providerLabel : "—"}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono font-medium text-foreground">
                <bdi dir="ltr">{cfg?.model || "—"}</bdi>
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {t("ai.hub.status.keyStored")}:{" "}
                <strong className="font-medium text-foreground">
                  {cfg
                    ? cfg.has_api_key
                      ? t("ai.hub.status.keyYes")
                      : t("ai.hub.status.keyNo")
                    : "—"}
                </strong>
              </span>
            </div>

            <Button type="button" size="sm" variant="outline" onClick={openAiSettings}>
              {t("ai.hub.status.changeInSettings")}
            </Button>
          </section>

          {/* Assistant tools */}
          <section aria-labelledby="ai-tools-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ai-tools-heading" className="text-sm font-semibold text-foreground">
                {t("ai.hub.toolsTitle")}
              </h2>
              {!aiEnabled && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("ai.hub.tools.setupRequired")}</span>
                  <button
                    type="button"
                    onClick={openAiSettings}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t("ai.hub.tools.setupLink")}
                  </button>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <div
                    key={tool.id}
                    className="flex flex-col justify-between gap-4 rounded-[14px] border border-border bg-card p-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                        <span>{t(tool.titleKey)}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t(tool.descKey)}
                      </p>
                    </div>
                    <div className="pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!aiEnabled}
                        className="w-full"
                        onClick={() => navigate?.(tool.route)}
                      >
                        {t(tool.actionKey)}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* In-screen helpers */}
          <section aria-labelledby="ai-inscreen-heading" className="space-y-3">
            <h2 id="ai-inscreen-heading" className="text-sm font-semibold text-foreground">
              {t("ai.hub.inScreenTitle")}
            </h2>
            <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
              {IN_SCREEN_HELPERS.map((helper) => (
                <li
                  key={helper.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{t(helper.titleKey)}</span>
                    <span className="text-muted-foreground">—</span>
                    <span className="text-muted-foreground">{t(helper.descKey)}</span>
                  </div>
                  <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t(helper.whereKey)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
