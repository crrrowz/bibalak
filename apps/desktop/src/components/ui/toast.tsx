import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { dur, ease, useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useToastStore, type ToastTone } from "@/stores/toast";

const TONE_META: Record<
  ToastTone,
  {
    icon: typeof Info;
    iconClass: string;
    borderClass: string;
    role: "status" | "alert";
    live: "polite" | "assertive";
  }
> = {
  success: {
    icon: CheckCircle2,
    iconClass: "text-green-600 dark:text-green-400",
    borderClass: "border-border",
    role: "status",
    live: "polite",
  },
  info: {
    icon: Info,
    iconClass: "text-primary",
    borderClass: "border-border",
    role: "status",
    live: "polite",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-destructive",
    borderClass: "border-destructive/40",
    role: "alert",
    live: "assertive",
  },
};

/**
 * Viewport toast stack rendered in the bottom-end corner (honors LTR & RTL
 * logical sides, `.glass-panel` depth, `prefers-reduced-motion`, and ARIA live regions).
 */
export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  const reduced = useReducedMotion();

  return (
    <div
      data-testid="toast-viewport"
      className="pointer-events-none fixed bottom-4 end-4 z-30 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
    >
      {items.map((item) => {
        const meta = TONE_META[item.tone];
        const Icon = meta.icon;
        return (
          <motion.div
            key={item.id}
            role={meta.role}
            aria-live={meta.live}
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: reduced ? 0 : dur.fast, ease }}
            className={cn(
              "glass-panel pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm text-foreground shadow-lg",
              meta.borderClass,
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", meta.iconClass)} aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-words leading-snug">{item.message}</p>
              {item.action && (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {item.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => dismiss(item.id)}
              className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
