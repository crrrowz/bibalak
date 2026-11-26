import { ScreenHeader } from "@/components/ScreenHeader";
import { StreakContent } from "@/features/motivation/StreakContent";
import { t } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

/** Thin route frame for `/streak` (renders `StreakContent`). */
export function StreakScreen() {
  const style = useStyle((s) => s.style);
  const titleKey =
    style === "game"
      ? "motivation.streak.title.game"
      : style === "scholar"
        ? "motivation.streak.title.scholar"
        : "motivation.streak.title.default";

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t(titleKey)} />
      <div className="min-h-0 flex-1 overflow-auto">
        <StreakContent showTitle={false} />
      </div>
    </div>
  );
}
