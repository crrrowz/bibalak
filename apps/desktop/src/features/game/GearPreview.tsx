import type {
  AvatarProfileDto,
  EquipmentSlot,
  EquippedSlotDto,
  SpendKind,
} from "@bibalak/ipc-types";
import { AvatarStage, type AvatarSize } from "@/components/avatar/AvatarStage";
import { FrostShieldIcon } from "@/components/icons/game";
import { cn } from "@/lib/utils";

export interface GearPreviewProps {
  slot: EquipmentSlot | null;
  itemKey: string;
  kind?: SpendKind;
  profile: AvatarProfileDto;
  equipped: EquippedSlotDto[];
  size?: AvatarSize;
  className?: string;
  testId?: string;
}

/**
 * Shared 64×64 (2× integer scale) preview thumbnail for Shop and Wardrobe items.
 * Cosmetic gear renders directly on the player's avatar so both equipped and
 * unequipped items show how they look; frames use a tighter corner radius so
 * their border pixels stay visible at 64 px.
 */
export function GearPreview({
  slot,
  itemKey,
  kind = "cosmetic",
  profile,
  equipped,
  size = 64,
  className,
  testId,
}: GearPreviewProps) {
  const resolvedTestId = testId ?? `gear-preview-${itemKey}`;

  if (kind === "freeze_token" || slot === null) {
    return (
      <div
        data-testid={resolvedTestId}
        style={{ width: `${size}px`, height: `${size}px` }}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl border border-border bg-[hsl(var(--game-freeze))]/10",
          className,
        )}
      >
        <FrostShieldIcon className="size-8 text-[hsl(var(--game-freeze))]" />
      </div>
    );
  }

  const previewEquipped: EquippedSlotDto[] = equipped.some((e) => e.slot === slot)
    ? equipped.map((e) => (e.slot === slot ? { ...e, item_key: itemKey } : e))
    : [...equipped, { slot, item_key: itemKey }];

  return (
    <div data-testid={resolvedTestId} className={cn("shrink-0", className)}>
      <AvatarStage
        style="game"
        size={size}
        profile={profile}
        equipped={previewEquipped}
        frameKey={slot === "frame" ? itemKey : undefined}
        className={cn(
          slot === "frame"
            ? "rounded-md border border-border/60"
            : "rounded-xl border border-border",
        )}
      />
    </div>
  );
}
