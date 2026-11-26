import { ScreenHeader } from "@/components/ScreenHeader";
import { CharacterContent } from "@/features/character/CharacterContent";
import { t } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

/** Thin frame for `/character` (renders `CharacterContent`). */
export function CharacterScreen() {
  const style = useStyle((s) => s.style);
  const isScholar = style === "scholar";

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={isScholar ? t("scholar.character.title") : t("game.character.title")}
        description={
          isScholar ? t("scholar.character.description") : t("game.character.description")
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <CharacterContent />
      </div>
    </div>
  );
}
