import {
  Award,
  Bell,
  CheckCircle2,
  RotateCcw,
  Shield,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { NotificationKind } from "./notificationStore";

export function NotificationKindIcon({
  kind,
  className = "size-4 shrink-0 text-primary",
}: {
  kind: NotificationKind;
  className?: string;
}) {
  switch (kind) {
    case "achievement":
      return <Award className={className} aria-hidden="true" />;
    case "level_up":
    case "title_up":
      return <TrendingUp className={className} aria-hidden="true" />;
    case "purchase":
      return <ShoppingBag className={className} aria-hidden="true" />;
    case "refund":
      return <RotateCcw className={className} aria-hidden="true" />;
    case "freeze":
      return <Shield className={className} aria-hidden="true" />;
    case "progress":
    case "goal":
      return <CheckCircle2 className={className} aria-hidden="true" />;
    case "unlock":
    case "pet":
    case "backfill":
    case "quest":
      return <Sparkles className={className} aria-hidden="true" />;
    default:
      return <Bell className={className} aria-hidden="true" />;
  }
}
