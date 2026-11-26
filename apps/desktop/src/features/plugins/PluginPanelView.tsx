import type { PanelBlock, PanelTone } from "@bibalak/plugin-sdk";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pluginHost, type PluginPanel } from "@/lib/pluginHost";

const TONE_CLASS: Record<PanelTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  accent: "text-primary",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

const BADGE_TONE_CLASS: Record<PanelTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
  accent: "bg-primary/15 text-primary",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/15 text-destructive",
};

function BlockView({ panel, block }: { panel: PluginPanel; block: PanelBlock }) {
  switch (block.type) {
    case "heading":
      return <h3 className="text-sm font-semibold text-foreground">{block.text}</h3>;
    case "text":
      return (
        <p className={cn("text-sm leading-relaxed", TONE_CLASS[block.tone ?? "default"])}>
          {block.text}
        </p>
      );
    case "stat":
      return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">{block.label}</span>
          <span className="text-sm font-semibold tabular-nums text-foreground">{block.value}</span>
        </div>
      );
    case "badge":
      return (
        <div>
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
              BADGE_TONE_CLASS[block.tone ?? "default"],
            )}
          >
            {block.text}
          </span>
        </div>
      );
    case "divider":
      return <hr className="border-border" />;
    case "actions":
      return (
        <div className="flex flex-wrap gap-2">
          {block.buttons.map((btn) => (
            <Button
              key={btn.id}
              size="sm"
              variant={btn.variant === "primary" ? "default" : "outline"}
              onClick={() =>
                pluginHost.invokePanelAction(panel.pluginId, panel.id, btn.id, btn.payload)
              }
            >
              {btn.label}
            </Button>
          ))}
        </div>
      );
    case "list":
      if (block.items.length === 0) {
        return block.emptyText ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {block.emptyText}
          </p>
        ) : null;
      }
      return (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {block.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                  {item.badge && (
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                      {item.badge}
                    </span>
                  )}
                </div>
                {item.subtitle && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</p>
                )}
              </div>
              {item.actionLabel && item.actionId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() =>
                    pluginHost.invokePanelAction(
                      panel.pluginId,
                      panel.id,
                      item.actionId!,
                      item.actionPayload,
                    )
                  }
                >
                  {item.actionLabel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      );
  }
}

/** Renders a plugin's declarative blocks inside a safe React container. */
export function PluginPanelView({ panel }: { panel: PluginPanel }) {
  return (
    <div className="space-y-3 p-4">
      {panel.blocks.map((block, index) => (
        <BlockView key={`${block.type}-${index}`} panel={panel} block={block} />
      ))}
    </div>
  );
}
