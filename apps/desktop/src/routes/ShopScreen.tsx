import { ScreenHeader } from "@/components/ScreenHeader";
import { ShopContent } from "@/features/shop/ShopContent";
import { t } from "@/lib/i18n";

/** Thin frame for `/shop` (renders `ShopContent`). */
export function ShopScreen() {
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("game.shop.title")} description={t("game.shop.description")} />
      <div className="min-h-0 flex-1 overflow-auto">
        <ShopContent />
      </div>
    </div>
  );
}
