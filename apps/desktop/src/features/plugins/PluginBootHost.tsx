import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ipc, isTauri } from "@/lib/ipc";
import { pluginHost } from "@/lib/pluginHost";
import { toast } from "@/stores/toast";

function isCompatibleApiVersion(version: string): boolean {
  if (!version) return true;
  const trimmed = version.trim();
  return trimmed === "0.2" || /^0\.2\.\d+$/.test(trimmed);
}

/**
 * Boots enabled plugins on app startup, wires safe navigation actions,
 * and routes plugin toasts/crash notifications to the app toast store.
 */
export function PluginBootHost() {
  const navigate = useNavigate();
  const bootedRef = useRef(false);

  useEffect(() => {
    pluginHost.setNavigationHandlers({
      openDeck: (deckId) => {
        void navigate({ to: "/study/$deckId", params: { deckId } });
      },
      openBrowse: (query) => {
        void navigate({ to: "/browse", search: query ? { q: query } : {} });
      },
    });
  }, [navigate]);

  useEffect(() => {
    const unsub = pluginHost.onToast((msg) => {
      const status = pluginHost.getStatus(msg.pluginId);
      if (status.status === "crashed") {
        toast.error(msg.message);
      } else {
        toast.info(msg.message);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isTauri() || bootedRef.current) return;
    bootedRef.current = true;
    let cancelled = false;

    void ipc
      .listPlugins()
      .then(async (plugins) => {
        for (const p of plugins) {
          if (cancelled || !p.enabled || !isCompatibleApiVersion(p.api_version)) continue;
          try {
            const code = await ipc.getPluginEntry(p.id);
            if (!cancelled) {
              pluginHost.load(p.id, p.permissions, code, {
                id: p.id,
                name: p.name,
                version: p.version,
                description: p.description ?? undefined,
                author: p.author ?? undefined,
                apiVersion: p.api_version || "0.2.0",
              });
            }
          } catch (err) {
            console.warn(`[plugin:${p.id}] failed to load on startup:`, err);
          }
        }
      })
      .catch((err) => {
        console.warn("[plugins] startup list failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
