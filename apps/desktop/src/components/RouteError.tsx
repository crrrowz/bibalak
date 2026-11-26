import { useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

interface Props {
  error: unknown;
}

/** Shown when a route throws during render or data loading. */
export function RouteError({ error }: Props) {
  const router = useRouter();
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="size-10 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("error.title")}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => router.invalidate()}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
