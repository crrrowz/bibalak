import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { formatNumber, t } from "@/lib/i18n";
import { Logo } from "@/components/Logo";

export interface StartupErrorInfo {
  kind: "schema_too_new" | "open_failed";
  found: number | null;
  supported: number | null;
  message: string;
}

export function StartupErrorScreen({ error }: { error: StartupErrorInfo }) {
  const isTooNew = error.kind === "schema_too_new";
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div
        data-tauri-drag-region
        className="glass-chrome flex h-9 shrink-0 items-center border-b px-3 select-none"
      >
        <div className="pointer-events-none">
          <Logo size={16} />
        </div>
      </div>
      <main className="flex flex-1 items-center justify-center p-6">
        <div
          role="alert"
          className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-start shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="text-base font-semibold text-foreground">
                {isTooNew ? t("safe.schemaTooNew.title") : t("safe.openFailed.title")}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {isTooNew && error.found !== null && error.supported !== null
                  ? t("safe.schemaTooNew.body", {
                      found: formatNumber(error.found),
                      supported: formatNumber(error.supported),
                    })
                  : t("safe.openFailed.body")}
              </p>
              {error.message ? (
                <p
                  className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                  dir="auto"
                >
                  {error.message}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function StartupErrorGate({ children }: { children: ReactNode }) {
  const tauri = isTauri();
  const query = useQuery({
    queryKey: queryKeys.startupError,
    queryFn: async (): Promise<StartupErrorInfo | null> => platform.invoke("get_startup_error"),
    enabled: tauri,
    staleTime: Infinity,
  });

  if (tauri && query.data) {
    return <StartupErrorScreen error={query.data} />;
  }

  return <>{children}</>;
}
