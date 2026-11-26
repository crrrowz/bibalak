import { useState } from "react";
import type { EquipmentSlot, GameStateDto } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { GearPreview } from "@/features/game/GearPreview";
import { formatNumber, t } from "@/lib/i18n";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import {
  EQUIPMENT_SLOTS,
  GAME_ITEM_LOCALE,
  SLOT_LABEL_MAP,
  inferSlotFromItemKey,
} from "./characterCatalog";
import { useEquipGameItemMutation, useUnequipGameSlotMutation } from "./useCharacterMutations";

export interface WardrobePanelProps {
  gameState: GameStateDto;
}

interface OwnedWardrobeItem {
  itemKey: string;
  slot: EquipmentSlot;
  equipped: boolean;
  twoHanded: boolean;
}

/**
 * Game wardrobe tab: slot filter pills, owned cosmetics with Equip/Unequip,
 * and read-only Consumables summary linking to `/shop`.
 */
export function WardrobePanel({ gameState }: WardrobePanelProps) {
  const [slotFilter, setSlotFilter] = useState<EquipmentSlot | "all">("all");
  const navigate = useOptionalNavigate();
  const equipMutation = useEquipGameItemMutation();
  const unequipMutation = useUnequipGameSlotMutation();

  const equippedBySlot = new Map<EquipmentSlot, string | null>(
    gameState.equipped.map((entry) => [entry.slot, entry.item_key]),
  );
  const catalogByKey = new Map(gameState.catalog.map((c) => [c.item_key, c]));

  const ownedItems: OwnedWardrobeItem[] = [];
  for (const itemKey of gameState.owned_item_keys) {
    const cat = catalogByKey.get(itemKey);
    const slot = cat?.slot ?? inferSlotFromItemKey(itemKey);
    if (!slot) continue;
    ownedItems.push({
      itemKey,
      slot,
      equipped: equippedBySlot.get(slot) === itemKey,
      twoHanded: cat?.two_handed ?? false,
    });
  }

  const filtered =
    slotFilter === "all" ? ownedItems : ownedItems.filter((item) => item.slot === slotFilter);
  const busy = equipMutation.isPending || unequipMutation.isPending;

  return (
    <section aria-label={t("game.character.tabWardrobe")} className="space-y-5">
      <div
        role="group"
        aria-label={t("game.character.wardrobeFilterAria")}
        className="flex flex-wrap gap-1.5"
      >
        <Button
          type="button"
          size="sm"
          variant={slotFilter === "all" ? "default" : "outline"}
          onClick={() => setSlotFilter("all")}
        >
          {t("game.slot.all")}
        </Button>
        {EQUIPMENT_SLOTS.map(({ slot, labelKey }) => (
          <Button
            key={slot}
            type="button"
            size="sm"
            variant={slotFilter === slot ? "default" : "outline"}
            onClick={() => setSlotFilter(slot)}
          >
            {t(labelKey)}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <span>{t("game.character.slotEmpty")}</span>
          <a
            href="/shop"
            onClick={(e) => {
              if (navigate) {
                e.preventDefault();
                navigate("/shop");
              }
            }}
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {t("game.character.visitShop")}
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {filtered.map((item) => {
            const labelKey = GAME_ITEM_LOCALE[item.itemKey];
            const itemName = labelKey ? t(labelKey) : item.itemKey;
            const slotLabel = t(SLOT_LABEL_MAP[item.slot]);

            return (
              <article
                key={item.itemKey}
                data-testid={`wardrobe-item-${item.itemKey}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <GearPreview
                    slot={item.slot}
                    itemKey={item.itemKey}
                    profile={gameState.avatar}
                    equipped={gameState.equipped}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h4 className="text-sm font-semibold leading-snug text-foreground">
                      {itemName}
                    </h4>
                    <p className="text-xs text-muted-foreground">{slotLabel}</p>
                  </div>
                </div>

                {item.equipped ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="shrink-0"
                    onClick={() => unequipMutation.mutate(item.slot)}
                  >
                    {t("game.unequip")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    className="shrink-0"
                    onClick={() => equipMutation.mutate({ slot: item.slot, itemKey: item.itemKey })}
                  >
                    {t("game.equip")}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Read-only Consumables summary linking to /shop */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{t("game.character.consumables")}</p>
          <p className="tnum text-xs text-muted-foreground">
            {t("game.freeze.name")} ·{" "}
            {t("game.freeze.held", {
              held: formatNumber(gameState.freeze_tokens_held),
              cap: formatNumber(gameState.freeze_token_cap),
            })}
          </p>
        </div>
        <a
          href="/shop"
          onClick={(e) => {
            if (navigate) {
              e.preventDefault();
              navigate("/shop");
            }
          }}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("game.character.visitShop")}
        </a>
      </div>
    </section>
  );
}
