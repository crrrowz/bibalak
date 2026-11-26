import type { IpcError } from "@bibalak/ipc-types";
import { t } from "@/lib/i18n";
import { errorMessage } from "@/lib/ipc";

export type AiErrorCategory =
  | "not-configured"
  | "no-key"
  | "network"
  | "provider"
  | "invalid-reply"
  | "unknown";

export interface MappedAiError {
  kind: AiErrorCategory;
  message: string;
}

/**
 * Map raw backend/HTTP AI errors into clear localized user messages without leaking
 * internal error prefixes, host traces, or secrets.
 */
export function mapAiErrorMessage(error: unknown): MappedAiError {
  const raw = errorMessage(error);
  const lower = raw.toLowerCase();
  const ipcKind =
    error && typeof error === "object" && "kind" in error
      ? (error as Partial<IpcError>).kind
      : undefined;

  if (
    lower.includes("disabled") ||
    lower.includes("not enabled") ||
    lower.includes("not configured") ||
    lower.includes("cannot be empty")
  ) {
    return { kind: "not-configured", message: t("ai.error.notConfigured") };
  }

  if (
    lower.includes("http 401") ||
    lower.includes("http 403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication")
  ) {
    return { kind: "no-key", message: t("ai.error.noKey") };
  }

  if (
    ipcKind === "format" ||
    lower.includes("invalid rewrite") ||
    lower.includes("invalid ollama json") ||
    lower.includes("invalid openai json") ||
    lower.includes("invalid json") ||
    lower.includes("expected json")
  ) {
    return { kind: "invalid-reply", message: t("ai.error.invalidReply") };
  }

  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("ai request failed") ||
    lower.includes("connection refused") ||
    lower.includes("forcibly closed") ||
    lower.includes("network") ||
    lower.includes("unreachable") ||
    lower.includes("dns")
  ) {
    return { kind: "network", message: t("ai.error.network") };
  }

  const statusMatch = raw.match(/HTTP\s+(\d{3})/i);
  if (statusMatch || lower.includes("provider returned") || lower.includes("rate limit")) {
    return {
      kind: "provider",
      message: statusMatch
        ? t("ai.error.providerStatus", { status: statusMatch[1] })
        : t("ai.error.provider"),
    };
  }

  return { kind: "unknown", message: t("ai.error.generic") };
}
