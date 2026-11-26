import { ScreenHeader } from "@/components/ScreenHeader";
import { QuestsContent } from "@/features/quests/QuestsContent";
import { t } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

/** Thin route frame for `/quests` (renders `QuestsContent`). */
export function QuestsScreen() {
  const style = useStyle((s) => s.style);
  const titleKey =
    style === "game"
      ? "motivation.quests.title.game"
      : style === "scholar"
        ? "motivation.quests.title.scholar"
        : "motivation.quests.title.default";

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t(titleKey)} />
      <div className="min-h-0 flex-1 overflow-auto">
        <QuestsContent />
      </div>
    </div>
  );
}
