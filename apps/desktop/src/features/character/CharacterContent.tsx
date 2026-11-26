import { useRef, useState } from "react";
import type { EquipmentSlot } from "@bibalak/ipc-types";
import { X } from "lucide-react";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { MountLayer, PetLayer, type PetSpecies } from "@/components/avatar/layers/game/pets";
import { Button } from "@/components/ui/button";
import { DEFAULT_AVATAR_PROFILE, TWO_HANDED_ITEM_KEYS } from "@/features/game/avatarLayers";
import { AchievementsPanel } from "@/features/game/depth/AchievementsPanel";
import { BackfillBanner } from "@/features/game/depth/BackfillBanner";
import { PathSelector } from "@/features/game/depth/PathSelector";
import { StablePanel } from "@/features/game/depth/StablePanel";
import { PET_SPECIES_LOCALE } from "@/features/game/depth/depthCatalog";
import { useGameDepthState } from "@/features/game/depth/useGameDepth";
import { useGameState } from "@/features/game/useGameState";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { formatNumber, t } from "@/lib/i18n";
import { getStyleSkin } from "@/lib/styles/skins";
import { cn } from "@/lib/utils";
import type { LocaleKey } from "@/locales/en";
import { useStyle } from "@/stores/style";
import { AppearanceEditor } from "./AppearanceEditor";
import { ScholarOutfitPreview } from "./ScholarOutfitPreview";
import { WardrobePanel } from "./WardrobePanel";
import { EQUIPMENT_SLOTS, GAME_ITEM_LOCALE } from "./characterCatalog";
import {
  useUnequipGameSlotMutation,
  useUpdateAvatarProfileMutation,
} from "./useCharacterMutations";

type CharacterTab = "appearance" | "wardrobe" | "stable" | "paths" | "achievements";

const GAME_TABS: ReadonlyArray<{ id: CharacterTab; labelKey: LocaleKey }> = [
  { id: "appearance", labelKey: "game.character.tabAppearance" },
  { id: "wardrobe", labelKey: "game.character.tabWardrobe" },
  { id: "stable", labelKey: "game.depth.stable.title" },
  { id: "paths", labelKey: "game.depth.paths.title" },
  { id: "achievements", labelKey: "game.depth.achievements.title" },
];

const SCHOLAR_TABS: ReadonlyArray<{ id: CharacterTab; labelKey: LocaleKey }> = [
  { id: "appearance", labelKey: "game.character.tabAppearance" },
  { id: "achievements", labelKey: "game.depth.achievements.title" },
];

/**
 * `/character` screen content for Game and Scholar styles.
 */
export function CharacterContent() {
  const style = useStyle((s) => s.style);
  const skin = getStyleSkin(style);
  const skinId = skin?.id ?? "game";
  const isScholar = skinId === "scholar";

  const gameQuery = useGameState(true);
  const progressQuery = useProgressSummary(isScholar);
  const depthQuery = useGameDepthState(true);
  const updateAvatar = useUpdateAvatarProfileMutation();
  const unequipSlot = useUnequipGameSlotMutation();

  const [tab, setTab] = useState<CharacterTab>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    const known: CharacterTab[] = ["appearance", "wardrobe", "stable", "paths", "achievements"];
    return known.includes(fromUrl as CharacterTab) ? (fromUrl as CharacterTab) : "appearance";
  });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabs = isScholar ? SCHOLAR_TABS : GAME_TABS;
  const activeTab: CharacterTab = tabs.some((entry) => entry.id === tab) ? tab : "appearance";

  const isLoading = gameQuery.isLoading || (isScholar && progressQuery.isLoading);
  const isError = gameQuery.isError || (isScholar && progressQuery.isError);

  if (isLoading) {
    return (
      <div aria-label={t("game.loading")} className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6 lg:p-8">
        <div className="h-44 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    );
  }

  if (isError || !gameQuery.data) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <span>{t("game.error")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void gameQuery.refetch();
              if (isScholar) void progressQuery.refetch();
            }}
          >
            {t("game.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const gameState = gameQuery.data;
  const level = isScholar ? (progressQuery.data?.level ?? gameState.level) : gameState.level;
  const rankInfo = (skin ?? getStyleSkin("game")!).rankForLevel(level);
  const profile = gameState.avatar ?? DEFAULT_AVATAR_PROFILE;
  const depthData = depthQuery.data;
  const activePet =
    !isScholar && depthData?.active_pet_id
      ? (depthData.pets.find((p) => p.id === depthData.active_pet_id) ?? null)
      : null;

  const equippedMap = new Map<EquipmentSlot, string | null>(
    gameState.equipped.map((entry) => [entry.slot, entry.item_key]),
  );
  const mainHandKey = equippedMap.get("main_hand") ?? null;
  const twoHandedActive = Boolean(mainHandKey && TWO_HANDED_ITEM_KEYS.has(mainHandKey));

  const petKey = activePet ? `${activePet.species_key}:${activePet.variant_key}` : null;
  const petSpeciesLocale = activePet
    ? (PET_SPECIES_LOCALE[activePet.species_key as PetSpecies] ?? "game.depth.pets.owl")
    : null;

  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    const nextDelta =
      e.key === "ArrowRight" ? (isRtl ? -1 : 1) : e.key === "ArrowLeft" ? (isRtl ? 1 : -1) : 0;

    let targetIdx: number | null = null;
    if (nextDelta !== 0) {
      targetIdx = (idx + nextDelta + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      targetIdx = 0;
    } else if (e.key === "End") {
      targetIdx = tabs.length - 1;
    }

    if (targetIdx !== null) {
      e.preventDefault();
      const targetTab = tabs[targetIdx];
      setTab(targetTab.id);
      tabRefs.current[targetTab.id]?.focus();
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <BackfillBanner />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        {/* Stage panel */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-4">
            <AvatarStage
              style={skinId}
              size={128}
              level={level}
              profile={profile}
              equipped={isScholar ? undefined : gameState.equipped}
              pet={
                activePet
                  ? { speciesKey: activePet.species_key, variantKey: activePet.variant_key }
                  : null
              }
              mounted={Boolean(activePet && depthData?.mounted)}
              className="rounded-xl border border-border"
            />

            {activePet && petKey && petSpeciesLocale && (
              <div
                data-testid="character-companion"
                dir="ltr"
                className="flex flex-col items-center gap-1 rounded-xl border border-border bg-secondary/40 p-2.5"
              >
                {depthData?.mounted ? (
                  <MountLayer itemKey={petKey} className="game-pixel-art h-12 w-12" />
                ) : (
                  <PetLayer itemKey={petKey} className="game-pixel-art h-12 w-12" />
                )}
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t(petSpeciesLocale)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h2
              className={cn(
                "text-lg font-semibold text-foreground",
                !isScholar && "game-hud-level",
              )}
            >
              {isScholar
                ? t("progress.scholarLevel", {
                    title: t(rankInfo.labelKey),
                    level: formatNumber(level),
                  })
                : t("game.hud.rankLevel", {
                    rank: t(rankInfo.labelKey),
                    level: formatNumber(level),
                  })}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isScholar ? t("scholar.character.outfitNote") : t("game.character.description")}
            </p>
          </div>

          {!isScholar && (
            <div className="space-y-2">
              {twoHandedActive && (
                <p className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground">
                  {t("game.twoHandedHint")}
                </p>
              )}

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                {EQUIPMENT_SLOTS.map(({ slot, labelKey }) => {
                  const equippedKey = equippedMap.get(slot) ?? null;
                  const itemLocale = equippedKey ? GAME_ITEM_LOCALE[equippedKey] : undefined;
                  const itemName = equippedKey
                    ? itemLocale
                      ? t(itemLocale)
                      : equippedKey
                    : t("game.character.emptySlot");
                  const maskedOffHand = slot === "off_hand" && twoHandedActive;

                  return (
                    <div
                      key={slot}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-xs",
                        maskedOffHand && "opacity-60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-muted-foreground">{t(labelKey)}: </span>
                        <span className="truncate text-foreground">{itemName}</span>
                      </div>
                      {equippedKey && (
                        <button
                          type="button"
                          aria-label={t("game.character.unequipSlot", { slot: t(labelKey) })}
                          disabled={unequipSlot.isPending}
                          onClick={() => unequipSlot.mutate(slot)}
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right / Main panel */}
        <section className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-5">
          <div
            role="tablist"
            aria-label={t("game.character.tabsAria")}
            className="flex flex-wrap gap-1.5 border-b border-border pb-3"
          >
            {tabs.map((entry, idx) => {
              const selected = activeTab === entry.id;
              return (
                <button
                  key={entry.id}
                  ref={(el) => {
                    tabRefs.current[entry.id] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    "min-h-9 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t(entry.labelKey)}
                </button>
              );
            })}
          </div>

          <div role="tabpanel">
            {activeTab === "appearance" && (
              <div className="space-y-6">
                {isScholar && <ScholarOutfitPreview level={level} profile={profile} />}
                <AppearanceEditor
                  profile={profile}
                  skinId={skinId}
                  onChange={(next) => updateAvatar.mutate(next)}
                />
              </div>
            )}

            {activeTab === "wardrobe" && !isScholar && <WardrobePanel gameState={gameState} />}
            {activeTab === "stable" && !isScholar && <StablePanel />}
            {activeTab === "paths" && !isScholar && <PathSelector />}
            {activeTab === "achievements" && <AchievementsPanel skinId={skinId} />}
          </div>
        </section>
      </div>
    </div>
  );
}
