import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { useToastStore } from "@/stores/toast";
import { runStartupUpdateCheck } from "./updateCheck";

const SETTINGS_CATEGORY_KEY = "keepsake-settings-category";

/**
 * Runs the quiet update check once when the main window starts (at most once
 * a day, only while "check on start" is on; see `updateCheck.ts`). A found
 * update shows a toast that opens Settings → Updates; nothing is downloaded
 * or installed without the user's click there.
 */
export function UpdateCheckHost() {
  const navigate = useOptionalNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runStartupUpdateCheck().then((update) => {
      if (!update) return;
      useToastStore
        .getState()
        .push("info", t("settings.updates.toastAvailable", { version: update.version }), {
          durationMs: 15_000,
          action: {
            label: t("settings.updates.toastView"),
            onClick: () => {
              try {
                sessionStorage.setItem(SETTINGS_CATEGORY_KEY, "updates");
              } catch {
                // sessionStorage unavailable
              }
              navigate?.("/settings");
            },
          },
        });
    });
  }, [navigate]);

  return null;
}
