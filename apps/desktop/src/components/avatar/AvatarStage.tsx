import type { AvatarProfileDto, EquippedSlotDto } from "@bibalak/ipc-types";
import { resolveAvatarLayers, type ResolvedAvatarLayer } from "@/features/game/avatarLayers";
import type { ActiveSkinId } from "@/lib/styles/skins";
import { cn } from "@/lib/utils";
import { BackdropLayer } from "./layers/common/BackdropLayer";
import { BodyLayer } from "./layers/common/BodyLayer";
import { HairLayer } from "./layers/common/HairLayer";
import { StarterAccessoryLayer } from "./layers/common/StarterAccessoryLayer";
import { StarterOutfitLayer } from "./layers/common/StarterOutfitLayer";
import { AccessoryLayer } from "./layers/game/AccessoryLayer";
import { BackLayer } from "./layers/game/BackLayer";
import { FrameLayer } from "./layers/game/FrameLayer";
import { HeadLayer } from "./layers/game/HeadLayer";
import { MainHandLayer } from "./layers/game/MainHandLayer";
import { OffHandLayer } from "./layers/game/OffHandLayer";
import { OutfitLayer } from "./layers/game/OutfitLayer";
import { MountLayer, PetLayer } from "./layers/game/pets";
import { ScholarBackLayer } from "./layers/scholar/ScholarBackLayer";
import { ScholarHeadLayer } from "./layers/scholar/ScholarHeadLayer";
import { ScholarOutfitLayer } from "./layers/scholar/ScholarOutfitLayer";

export type AvatarSize = 32 | 64 | 128 | 192;

export interface AvatarStageProps {
  style: ActiveSkinId;
  size: AvatarSize;
  level?: number;
  profile?: AvatarProfileDto | null;
  equipped?: EquippedSlotDto[] | null;
  /** Reserved for 14e (R4-3) pets & mounts */
  pet?: { speciesKey: string; variantKey: string } | null;
  mounted?: boolean;
  frameKey?: string | null;
  className?: string;
}

function renderLayer(layer: ResolvedAvatarLayer) {
  const commonProps = {
    className: "game-pixel-art absolute inset-0 h-full w-full pointer-events-none",
    style: { zIndex: layer.zIndex },
  };

  switch (layer.slot) {
    case "backdrop":
      return (
        <BackdropLayer key={`backdrop-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      );
    case "back":
      return layer.source === "scholar" ? (
        <ScholarBackLayer key={`back-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      ) : (
        <BackLayer key={`back-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      );
    case "body":
      return <BodyLayer key={`body-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />;
    case "outfit":
      if (layer.source === "scholar") {
        return (
          <ScholarOutfitLayer
            key={`outfit-${layer.itemKey}`}
            itemKey={layer.itemKey}
            {...commonProps}
          />
        );
      }
      if (layer.source === "game") {
        return (
          <OutfitLayer key={`outfit-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
        );
      }
      return (
        <StarterOutfitLayer
          key={`outfit-${layer.itemKey}`}
          itemKey={layer.itemKey}
          {...commonProps}
        />
      );
    case "hair":
      return (
        <HairLayer
          key={`hair-${layer.itemKey}-${layer.hairColor ?? "black"}`}
          itemKey={layer.itemKey}
          hairColor={layer.hairColor}
          {...commonProps}
        />
      );
    case "accessory":
      return layer.source === "game" ? (
        <AccessoryLayer key={`acc-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      ) : (
        <StarterAccessoryLayer
          key={`acc-${layer.itemKey}`}
          itemKey={layer.itemKey}
          {...commonProps}
        />
      );
    case "head":
      return layer.source === "scholar" ? (
        <ScholarHeadLayer key={`head-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      ) : (
        <HeadLayer key={`head-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      );
    case "off_hand":
      return <OffHandLayer key={`off-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />;
    case "main_hand":
      return (
        <MainHandLayer key={`main-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />
      );
    case "frame":
      return <FrameLayer key={`frame-${layer.itemKey}`} itemKey={layer.itemKey} {...commonProps} />;
    case "pet":
    case "mount": {
      // Companion sits at half size (an integer scale) in the bottom inline-end
      // corner so it never covers the avatar (review 14e).
      const Companion = layer.slot === "mount" ? MountLayer : PetLayer;
      return (
        <Companion
          key={`${layer.slot}-${layer.itemKey}`}
          itemKey={layer.itemKey}
          className="game-pixel-art pointer-events-none absolute bottom-0 end-0 h-1/2 w-1/2"
          style={{ zIndex: layer.zIndex }}
        />
      );
    }
    default:
      return null;
  }
}

/**
 * Shared 16×16 integer-scaled SVG paper-doll stage for Game and Scholar styles.
 * Never mirrored in RTL (`dir="ltr"` enforced on stage).
 */
export function AvatarStage({
  style,
  size,
  level = 1,
  profile,
  equipped,
  pet,
  mounted = false,
  frameKey,
  className,
}: AvatarStageProps) {
  const layers = resolveAvatarLayers({
    style,
    level,
    profile,
    equipped,
    pet,
    mounted,
    frameKey,
  });

  return (
    <div
      data-testid="avatar-stage"
      data-style-skin={style}
      dir="ltr"
      aria-hidden="true"
      style={{ width: `${size}px`, height: `${size}px` }}
      className={cn("relative shrink-0 overflow-hidden", className)}
    >
      {layers.map(renderLayer)}
    </div>
  );
}
