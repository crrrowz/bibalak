import { useSyncExternalStore } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { panelKey, pluginHost } from "@/lib/pluginHost";
import { PluginPanelView } from "./PluginPanelView";

/** Non-modal side drawer hosting whichever plugin panel the user opened from the sidebar. */
export function PluginPanelDrawer() {
  const snapshot = useSyncExternalStore(pluginHost.subscribe, pluginHost.getSnapshot);
  const activePanel = snapshot.panels.find(
    (p) => panelKey(p.pluginId, p.id) === snapshot.activePanelKey,
  );

  return (
    <SidePanel
      open={Boolean(activePanel)}
      title={activePanel?.title ?? ""}
      onClose={() => pluginHost.closePanel()}
      width={360}
    >
      {activePanel && <PluginPanelView panel={activePanel} />}
    </SidePanel>
  );
}
