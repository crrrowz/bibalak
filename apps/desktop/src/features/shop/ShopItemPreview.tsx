import type { AvatarProfileDto, EquippedSlotDto, ShopItemDto } from "@bibalak/ipc-types";
import { GearPreview } from "@/features/game/GearPreview";

/**
 * Crisp 64×64 (2× integer scale) preview thumbnail for a Shop catalog item.
 * Delegates to the shared `GearPreview` component used by both Shop and Wardrobe.
 */
export function ShopItemPreview({
  item,
  profile,
  equipped,
}: {
  item: ShopItemDto;
  profile: AvatarProfileDto;
  equipped: EquippedSlotDto[];
}) {
  return (
    <GearPreview
      slot={item.slot}
      itemKey={item.item_key}
      kind={item.kind}
      profile={profile}
      equipped={equipped}
    />
  );
}
