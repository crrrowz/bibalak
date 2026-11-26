import type { AvatarProfileDto, AvatarProfileInput } from "@bibalak/ipc-types";
import { HairLayer } from "@/components/avatar/layers/common/HairLayer";
import { Button } from "@/components/ui/button";
import { DEFAULT_AVATAR_PROFILE } from "@/features/game/avatarLayers";
import { formatNumber, t } from "@/lib/i18n";
import type { ActiveSkinId } from "@/lib/styles/skins";
import { cn } from "@/lib/utils";
import {
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  STARTER_ACCESSORIES,
  STARTER_OUTFITS,
} from "./characterCatalog";

export interface AppearanceEditorProps {
  profile: AvatarProfileDto;
  skinId: ActiveSkinId;
  onChange: (next: AvatarProfileInput) => void;
}

/**
 * Free appearance editor shared by Game and Scholar:
 * Skin tone, hair style, and hair colour in both styles, plus starter tunic/accessory in Game.
 */
export function AppearanceEditor({ profile, skinId, onChange }: AppearanceEditorProps) {
  const update = (patch: Partial<AvatarProfileInput>) => {
    onChange({
      body_tone: profile.body_tone,
      hair_style: profile.hair_style,
      hair_color: profile.hair_color,
      starter_outfit: profile.starter_outfit,
      starter_accessory: profile.starter_accessory,
      ...patch,
    });
  };

  return (
    <section aria-label={t("game.character.tabAppearance")} className="space-y-5">
      {/* Skin tone */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t("game.character.skinTone")}</h3>
        <div className="flex flex-wrap gap-2">
          {SKIN_TONES.map((tone) => {
            const active = profile.body_tone === tone.id;
            return (
              <button
                key={tone.id}
                type="button"
                aria-pressed={active}
                aria-label={t("game.character.toneOption", { n: formatNumber(tone.n) })}
                onClick={() => update({ body_tone: tone.id })}
                className={cn(
                  "h-9 w-9 rounded-lg border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active ? "scale-105 border-primary" : "border-border hover:border-foreground/50",
                )}
                style={{ backgroundColor: tone.hex }}
              />
            );
          })}
        </div>
      </div>

      {/* Hair style */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t("game.character.hairStyle")}</h3>
        <div className="flex flex-wrap gap-2">
          {HAIR_STYLES.map((styleKey, idx) => {
            const active = profile.hair_style === styleKey;
            return (
              <button
                key={styleKey}
                type="button"
                aria-pressed={active}
                aria-label={t("game.character.hairStyleOption", { n: formatNumber(idx + 1) })}
                onClick={() => update({ hair_style: styleKey })}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-lg border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-primary/10" : "border-border hover:bg-accent/60",
                )}
              >
                <div dir="ltr" className="h-7 w-7">
                  <HairLayer
                    itemKey={styleKey}
                    hairColor={profile.hair_color}
                    className="game-pixel-art h-full w-full"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hair color */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t("game.character.hairColor")}</h3>
        <div className="flex flex-wrap gap-2">
          {HAIR_COLORS.map((color) => {
            const active = profile.hair_color === color.id;
            return (
              <button
                key={color.id}
                type="button"
                aria-pressed={active}
                aria-label={t(color.labelKey)}
                onClick={() => update({ hair_color: color.id })}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-sm border border-border"
                  style={{ backgroundColor: color.hex }}
                />
                <span>{t(color.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Game-only starter outfit and accessory */}
      {skinId === "game" && (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              {t("game.character.starterOutfit")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {STARTER_OUTFITS.map((tunic) => {
                const active = profile.starter_outfit === tunic.id;
                return (
                  <button
                    key={tunic.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => update({ starter_outfit: tunic.id })}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 rounded-sm border border-border"
                      style={{ backgroundColor: tunic.hex }}
                    />
                    <span>{t(tunic.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              {t("game.character.starterAccessory")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {STARTER_ACCESSORIES.map((acc) => {
                const active = profile.starter_accessory === acc.id;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => update({ starter_accessory: acc.id })}
                    className={cn(
                      "inline-flex min-h-9 items-center rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {t(acc.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange({ ...DEFAULT_AVATAR_PROFILE })}
        >
          {t("game.character.reset")}
        </Button>
      </div>
    </section>
  );
}
