import { BookOpen, Coffee, Film, Gamepad2, Gift, Music, Sparkles, Sun } from "lucide-react";
import type { RewardIconKey } from "./shopTypes";

/** Render one of the 8 custom-reward icons on a crisp 24px vector grid. */
export function RewardIconGlyph({ iconKey, className }: { iconKey: string; className?: string }) {
  switch (iconKey as RewardIconKey) {
    case "coffee":
      return <Coffee className={className} aria-hidden="true" />;
    case "film":
      return <Film className={className} aria-hidden="true" />;
    case "gamepad":
      return <Gamepad2 className={className} aria-hidden="true" />;
    case "music":
      return <Music className={className} aria-hidden="true" />;
    case "book":
      return <BookOpen className={className} aria-hidden="true" />;
    case "sun":
      return <Sun className={className} aria-hidden="true" />;
    case "sparkles":
      return <Sparkles className={className} aria-hidden="true" />;
    default:
      return <Gift className={className} aria-hidden="true" />;
  }
}
