import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { AIProviderKind } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { mapAiErrorMessage } from "@/lib/aiErrors";
import { t } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";

export const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.1";

function previewOrigin(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return rawUrl.trim() || "—";
  }
}

export function AISetupForm() {
  const queryClient = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: ipc.aiGetConfig,
  });

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AIProviderKind>("open-ai-compatible");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_OPENAI_URL);
  const [model, setModel] = useState(DEFAULT_OPENAI_MODEL);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!cfgQuery.data) return;
    setEnabled(cfgQuery.data.enabled);
    setProvider(cfgQuery.data.provider);
    setBaseUrl(cfgQuery.data.base_url);
    setModel(cfgQuery.data.model);
    setHasApiKey(cfgQuery.data.has_api_key);
  }, [cfgQuery.data]);

  function applyPreset(next: AIProviderKind, forceDefaults = false) {
    setProvider(next);
    if (next === "ollama") {
      if (forceDefaults || baseUrl.trim() === "" || baseUrl.trim() === DEFAULT_OPENAI_URL) {
        setBaseUrl(DEFAULT_OLLAMA_URL);
      }
      if (forceDefaults || model.trim() === "" || model.trim() === DEFAULT_OPENAI_MODEL) {
        setModel(DEFAULT_OLLAMA_MODEL);
      }
    } else {
      if (forceDefaults || baseUrl.trim() === "" || baseUrl.trim() === DEFAULT_OLLAMA_URL) {
        setBaseUrl(DEFAULT_OPENAI_URL);
      }
      if (forceDefaults || model.trim() === "" || model.trim() === DEFAULT_OLLAMA_MODEL) {
        setModel(DEFAULT_OPENAI_MODEL);
      }
    }
  }

  async function saveSettings(clearKey = false): Promise<void> {
    setStatusMsg(null);
    setErrorMsg(null);
    setSaving(true);
    try {
      const api_key = clearKey ? "" : apiKeyInput.trim().length > 0 ? apiKeyInput : null;
      const saved = await ipc.aiSetConfig({
        enabled,
        provider,
        base_url: baseUrl,
        model,
        api_key,
      });
      setEnabled(saved.enabled);
      setProvider(saved.provider);
      setBaseUrl(saved.base_url);
      setModel(saved.model);
      setHasApiKey(saved.has_api_key);
      setApiKeyInput("");
      setStatusMsg(t("ai.settings.saved"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiConfig });
    } catch (err) {
      setErrorMsg(mapAiErrorMessage(err).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    setStatusMsg(null);
    setErrorMsg(null);
    setTesting(true);
    try {
      const api_key = apiKeyInput.trim().length > 0 ? apiKeyInput : null;
      const saved = await ipc.aiSetConfig({
        enabled,
        provider,
        base_url: baseUrl,
        model,
        api_key,
      });
      setHasApiKey(saved.has_api_key);
      setApiKeyInput("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiConfig });

      const result = await ipc.aiRunAction({ kind: "test-connection" });
      setStatusMsg(t("ai.settings.testOk", { reply: result.text || "OK" }));
    } catch (err) {
      setErrorMsg(mapAiErrorMessage(err).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Step 1: Provider & model */}
      <div
        data-testid="ai-step-provider"
        className="space-y-3 rounded-xl border border-border bg-background/50 p-4"
      >
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("ai.setup.step1")}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("ai.setup.step1Hint")}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("ai.settings.presetHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={provider === "open-ai-compatible" ? "secondary" : "outline"}
              size="sm"
              onClick={() => applyPreset("open-ai-compatible", true)}
            >
              {t("ai.settings.presetOpenAi")}
            </Button>
            <Button
              type="button"
              variant={provider === "ollama" ? "secondary" : "outline"}
              size="sm"
              onClick={() => applyPreset("ollama", true)}
            >
              {t("ai.settings.presetOllama")}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="ai-provider" className="block text-sm font-medium">
              {t("ai.settings.provider")}
            </label>
            <Select
              id="ai-provider"
              value={provider}
              onChange={(e) => applyPreset(e.target.value as AIProviderKind)}
            >
              <option value="open-ai-compatible">{t("ai.settings.providerOpenAi")}</option>
              <option value="ollama">{t("ai.settings.providerOllama")}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ai-model" className="block text-sm font-medium">
              {t("ai.settings.model")}
            </label>
            <input
              id="ai-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ai-base-url" className="block text-sm font-medium">
            {t("ai.settings.baseUrl")}
          </label>
          <input
            id="ai-base-url"
            type="url"
            dir="ltr"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="h-9 w-full rounded-xl border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Step 2: API key */}
      <div
        data-testid="ai-step-key"
        className="space-y-2 rounded-xl border border-border bg-background/50 p-4"
      >
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("ai.setup.step2")}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("ai.setup.step2Hint")}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ai-api-key" className="text-sm font-medium">
              {t("ai.settings.apiKey")}
            </label>
            {hasApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                disabled={saving || testing}
                onClick={() => void saveSettings(true)}
              >
                {t("ai.settings.apiKeyClear")}
              </Button>
            )}
          </div>
          <input
            id="ai-api-key"
            type="password"
            dir="ltr"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={t("ai.settings.apiKeyPlaceholder")}
            autoComplete="off"
            className="h-9 w-full rounded-xl border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {hasApiKey && (
            <p className="text-xs text-muted-foreground">{t("ai.settings.apiKeySaved")}</p>
          )}
        </div>
      </div>

      {/* Step 3: Test connection */}
      <div
        data-testid="ai-step-test"
        className="space-y-3 rounded-xl border border-border bg-background/50 p-4"
      >
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("ai.setup.step3")}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("ai.setup.step3Hint")}</p>
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{t("ai.settings.testPayloadTitle")}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span>{t("ai.destination")}:</span>
            <bdi dir="ltr" className="font-mono text-foreground">
              {previewOrigin(baseUrl)} · {model.trim() || "—"}
            </bdi>
          </div>
          <div className="mt-1">{t("ai.settings.testPayloadBody")}</div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving || testing}
          onClick={() => void handleTestConnection()}
        >
          {testing && <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden />}
          {t("ai.settings.testConnection")}
        </Button>
      </div>

      {/* Step 4: Consent & enable */}
      <div
        data-testid="ai-step-consent"
        className="space-y-3 rounded-xl border border-border bg-background/50 p-4"
      >
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("ai.setup.step4")}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("ai.setup.step4Hint")}</p>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 accent-primary"
          />
          <span>{t("ai.settings.enable")}</span>
        </label>

        <Button
          type="button"
          size="sm"
          disabled={saving || testing}
          onClick={() => void saveSettings(false)}
        >
          {saving && <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden />}
          {t("ai.settings.save")}
        </Button>
      </div>

      {statusMsg && (
        <div
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/10 px-3 py-2 text-xs text-foreground"
        >
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {errorMsg}
        </p>
      )}
    </div>
  );
}
