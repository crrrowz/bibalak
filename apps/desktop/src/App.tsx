import { Suspense, lazy } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { Providers } from "@/app/providers";
import { router } from "@/app/router";
import { t, useLocale } from "@/lib/i18n";
import { platform } from "@/lib/platform";
import { useCoreEvents } from "@/lib/useCoreEvents";
import { StartupErrorGate } from "@/components/StartupErrorScreen";
import "@/stores/theme";
import "@/stores/style";

const QuickAddScreen = lazy(() =>
  import("@/features/add/QuickAddScreen").then((m) => ({ default: m.QuickAddScreen })),
);

function isQuickAddWindow(): boolean {
  if (platform.window?.label?.() === "quick-add") return true;
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search).get("window") === "quick-add";
  }
  return false;
}

function QuickAddRoot() {
  useCoreEvents();
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="flex h-screen items-center justify-center text-sm text-muted-foreground"
        >
          {t("common.loading")}
        </div>
      }
    >
      <QuickAddScreen />
    </Suspense>
  );
}

export default function App() {
  // Re-mount the route tree on language change so every `t()` re-renders;
  // the router keeps the current location, queries stay cached.
  const locale = useLocale((s) => s.locale);
  const quickAdd = isQuickAddWindow();

  return (
    <Providers>
      <StartupErrorGate>
        {quickAdd ? <QuickAddRoot key={locale} /> : <RouterProvider key={locale} router={router} />}
      </StartupErrorGate>
    </Providers>
  );
}
