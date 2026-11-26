import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RotateCcw, ShoppingBag, Trash2 } from "lucide-react";
import type {
  CustomRewardDto,
  CustomRewardInput,
  EquipmentSlot,
  GameStateDto,
  ShopItemDto,
  SpendHistoryEntryDto,
} from "@bibalak/ipc-types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FrostShieldIcon } from "@/components/icons/game";
import { GoldIcon } from "@/components/icons/progress";
import { Button } from "@/components/ui/button";
import { gameItemTitle, spendEntryLabel } from "@/features/game/itemTitle";
import { useGameState } from "@/features/game/useGameState";
import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { playStyleCue } from "@/lib/styleAudio";
import { formatCurrency, formatPoints } from "@/lib/styles/scholar";
import { cn } from "@/lib/utils";
import type { LocaleKey } from "@/locales/en";
import { toast } from "@/stores/toast";
import { CustomRewardDialog } from "./CustomRewardDialog";
import { RewardIconGlyph } from "./rewardIcons";
import { ShopItemPreview } from "./ShopItemPreview";

type ShopTab = "items" | "custom" | "history";
type SlotFilter = "all" | Exclude<EquipmentSlot, "frame">;

const REFUND_WINDOW_MS = 300_000;
const MAX_CUSTOM_REWARDS = 50;

const SHOP_SLOT_FILTERS: ReadonlyArray<SlotFilter> = [
  "all",
  "head",
  "outfit",
  "main_hand",
  "off_hand",
  "back",
  "accessory",
  "backdrop",
];

function slotLabel(slot: EquipmentSlot): string {
  return t(`game.slot.${slot}` as LocaleKey);
}

/**
 * Full Game Shop screen content: Items catalogue (cosmetics + streak freeze),
 * Custom Rewards CRUD & claiming, and 5-minute-refundable Purchase History.
 */
export function ShopContent() {
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  const [activeTab, setActiveTab] = useState<ShopTab>("items");
  const [slotFilter, setSlotFilter] = useState<SlotFilter>("all");
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<CustomRewardDto | null>(null);
  const [deletingReward, setDeletingReward] = useState<CustomRewardDto | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const gameQuery = useGameState(true);
  const rewardsQuery = useQuery({
    queryKey: queryKeys.customRewards,
    queryFn: ipc.listCustomRewards,
    enabled: tauri,
  });
  const historyQuery = useQuery({
    queryKey: queryKeys.spendHistory,
    queryFn: () => ipc.listSpendHistory(50),
    enabled: tauri,
  });

  useEffect(() => {
    if (activeTab !== "history") return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [activeTab]);

  const invalidateShopQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.gameState }),
      queryClient.invalidateQueries({ queryKey: queryKeys.customRewards }),
      queryClient.invalidateQueries({ queryKey: queryKeys.spendHistory }),
      queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary }),
    ]);
  };

  const applyGameState = (nextState: GameStateDto) => {
    queryClient.setQueryData(queryKeys.gameState, nextState);
  };

  const refundMut = useMutation({
    mutationFn: ({ spendId }: { spendId: string; label: string; amountCents: number }) =>
      ipc.refundShopPurchase(spendId),
    onSuccess: (nextState, vars) => {
      applyGameState(nextState);
      void invalidateShopQueries();
      toast.success(
        t("game.shop.refundedToast", {
          item: vars.label,
          gold: formatPoints(vars.amountCents),
        }),
        {
          notification: {
            kind: "refund",
            link: "/shop",
            dedupeKey: `refund:${vars.spendId}`,
          },
        },
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const buyMut = useMutation({
    mutationFn: async ({ item }: { item: ShopItemDto }) => {
      const clientTxId = crypto.randomUUID();
      return ipc.buyShopItem(item.item_key, clientTxId);
    },
    onSuccess: (res, { item }) => {
      playStyleCue("purchase");
      applyGameState(res.state);
      void invalidateShopQueries();
      const label = gameItemTitle(item.item_key);
      toast.success(
        t("game.shop.purchasedToast", {
          item: label,
          gold: formatPoints(item.price_cents),
        }),
        {
          durationMs: 10_000,
          notification: {
            kind: "purchase",
            link: "/shop",
            dedupeKey: `spend:${res.spend_id}`,
          },
          action: {
            label: t("game.shop.refund"),
            onClick: () =>
              refundMut.mutate({
                spendId: res.spend_id,
                label,
                amountCents: item.price_cents,
              }),
          },
        },
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const equipMut = useMutation({
    mutationFn: ({ slot, itemKey }: { slot: EquipmentSlot; itemKey: string }) =>
      ipc.equipGameItem(slot, itemKey),
    onSuccess: (nextState) => {
      applyGameState(nextState);
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const unequipMut = useMutation({
    mutationFn: (slot: EquipmentSlot) => ipc.unequipGameSlot(slot),
    onSuccess: (nextState) => {
      applyGameState(nextState);
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createRewardMut = useMutation({
    mutationFn: (input: CustomRewardInput) => ipc.createCustomReward(input),
    onSuccess: () => void invalidateShopQueries(),
  });

  const updateRewardMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CustomRewardInput }) =>
      ipc.updateCustomReward(id, input),
    onSuccess: () => void invalidateShopQueries(),
  });

  const deleteRewardMut = useMutation({
    mutationFn: (id: string) => ipc.deleteCustomReward(id),
    onSuccess: () => {
      setDeletingReward(null);
      void invalidateShopQueries();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const claimRewardMut = useMutation({
    mutationFn: async ({ reward }: { reward: CustomRewardDto }) => {
      const clientTxId = crypto.randomUUID();
      return ipc.claimCustomReward(reward.id, clientTxId);
    },
    onSuccess: (res, { reward }) => {
      playStyleCue("purchase");
      applyGameState(res.state);
      void invalidateShopQueries();
      toast.success(
        t("game.shop.purchasedToast", {
          item: reward.title,
          gold: formatPoints(reward.cost_cents),
        }),
        {
          durationMs: 10_000,
          notification: {
            kind: "purchase",
            link: "/shop",
            dedupeKey: `spend:${res.spend_id}`,
          },
          action: {
            label: t("game.shop.refund"),
            onClick: () =>
              refundMut.mutate({
                spendId: res.spend_id,
                label: reward.title,
                amountCents: reward.cost_cents,
              }),
          },
        },
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const state = gameQuery.data;
  const rewards = rewardsQuery.data ?? [];
  const history = historyQuery.data ?? [];

  const freezeItem = useMemo(
    () => state?.catalog.find((c) => c.kind === "freeze_token") ?? null,
    [state],
  );

  const cosmeticItems = useMemo(() => {
    if (!state) return [];
    const list = state.catalog.filter((c) => c.kind === "cosmetic");
    if (slotFilter === "all") return list;
    return list.filter((c) => c.slot === slotFilter);
  }, [state, slotFilter]);

  const tabs: ReadonlyArray<{ id: ShopTab; label: string }> = [
    { id: "items", label: t("game.shop.tabItems") },
    { id: "custom", label: t("game.shop.tabCustom") },
    { id: "history", label: t("game.shop.tabHistory") },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    const step = (e.key === "ArrowRight" ? 1 : -1) * (isRtl ? -1 : 1);
    const nextIdx = (idx + step + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIdx].id);
    tabsRef.current[nextIdx]?.focus();
  };

  if (!tauri) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <EmptyState icon={ShoppingBag} title={t("game.shop.title")} description={t("game.error")} />
      </div>
    );
  }

  if (gameQuery.isLoading) {
    return (
      <div data-testid="shop-loading" className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="h-16 animate-pulse rounded-xl border border-border bg-card" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  if (gameQuery.isError || !state) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <div className="space-y-3 rounded-xl border border-destructive/40 bg-card p-6 text-sm text-destructive">
          <p>{t("game.error")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void gameQuery.refetch()}
          >
            {t("game.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const availableGold = state.available_gold_cents;
  const freezeAtCap = state.freeze_tokens_held >= state.freeze_token_cap;
  const atMaxCustomRewards = rewards.length >= MAX_CUSTOM_REWARDS;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Gold & Freeze header summary */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div
            data-testid="shop-gold-balance"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-1.5 text-sm font-semibold text-[hsl(var(--game-gold))]"
          >
            <GoldIcon className="size-4 shrink-0" />
            <span className="tnum">{formatCurrency(availableGold, "game")}</span>
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-1.5 text-xs font-medium text-[hsl(var(--game-freeze))]">
            <FrostShieldIcon className="size-4 shrink-0" />
            <span className="tnum">
              {t("game.freeze.held", {
                held: formatNumber(state.freeze_tokens_held),
                cap: formatNumber(state.freeze_token_cap),
              })}
            </span>
          </div>
        </div>

        <div
          role="tablist"
          aria-label={t("game.shop.title")}
          className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
        >
          {tabs.map((tab, idx) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabsRef.current[idx] = el;
                }}
                id={`${baseId}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={cn(
                  "min-h-8 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Tab 1: Items */}
      {activeTab === "items" && (
        <div
          id={`${baseId}-panel-items`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-items`}
          className="space-y-6"
        >
          {freezeItem && (
            <section
              data-testid={`shop-item-${freezeItem.item_key}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <ShopItemPreview
                  item={freezeItem}
                  profile={state.avatar}
                  equipped={state.equipped}
                />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">
                      {t("game.freeze.name")}
                    </h2>
                    <span className="tnum rounded-md border border-[hsl(var(--game-freeze))]/30 bg-[hsl(var(--game-freeze))]/10 px-2 py-0.5 text-xs font-medium text-[hsl(var(--game-freeze))]">
                      {t("game.freeze.held", {
                        held: formatNumber(state.freeze_tokens_held),
                        cap: formatNumber(state.freeze_token_cap),
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{t("game.freeze.desc")}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="tnum text-sm font-semibold text-[hsl(var(--game-gold))]">
                  {formatCurrency(freezeItem.price_cents, "game")}
                </span>
                {freezeAtCap ? (
                  <Button type="button" size="sm" variant="outline" disabled>
                    {t("game.shop.maxHeld", { cap: formatNumber(state.freeze_token_cap) })}
                  </Button>
                ) : availableGold < freezeItem.price_cents ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled
                    title={t("game.shop.needGold", {
                      missing: formatPoints(freezeItem.price_cents - availableGold),
                    })}
                  >
                    {t("game.shop.needGold", {
                      missing: formatPoints(freezeItem.price_cents - availableGold),
                    })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={buyMut.isPending}
                    onClick={() => buyMut.mutate({ item: freezeItem })}
                  >
                    {t("game.shop.buy", { price: formatPoints(freezeItem.price_cents) })}
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* Slot filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {SHOP_SLOT_FILTERS.map((slot) => {
              const selected = slotFilter === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSlotFilter(slot)}
                  className={cn(
                    "min-h-8 rounded-lg border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {slot === "all" ? t("game.slot.all") : slotLabel(slot)}
                </button>
              );
            })}
          </div>

          {/* Cosmetic catalogue grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cosmeticItems.map((item) => {
              const shortfall = Math.max(0, item.price_cents - availableGold);
              const insufficient = !item.owned && shortfall > 0;
              const shortfallText = insufficient
                ? t("game.shop.needGold", { missing: formatPoints(shortfall) })
                : undefined;

              return (
                <article
                  key={item.item_key}
                  data-testid={`shop-item-${item.item_key}`}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-3.5">
                    <ShopItemPreview item={item} profile={state.avatar} equipped={state.equipped} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">
                        {gameItemTitle(item.item_key)}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.slot && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                            {slotLabel(item.slot)}
                          </span>
                        )}
                        {item.owned && (
                          <span className="rounded border border-good/30 bg-good/10 px-1.5 py-0.5 text-[11px] font-medium text-good">
                            {t("game.shop.owned")}
                          </span>
                        )}
                      </div>
                      {item.two_handed && (
                        <p className="text-[11px] text-muted-foreground">
                          {t("game.twoHandedHint")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                    <span className="tnum inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--game-gold))]">
                      <GoldIcon className="size-3.5 shrink-0" />
                      {formatCurrency(item.price_cents, "game")}
                    </span>

                    {item.owned && item.slot ? (
                      item.equipped ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={unequipMut.isPending}
                          onClick={() => unequipMut.mutate(item.slot!)}
                        >
                          {t("game.equipped")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={equipMut.isPending}
                          onClick={() =>
                            equipMut.mutate({ slot: item.slot!, itemKey: item.item_key })
                          }
                        >
                          {t("game.equip")}
                        </Button>
                      )
                    ) : insufficient ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled
                        title={shortfallText}
                      >
                        {shortfallText}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={buyMut.isPending}
                        onClick={() => buyMut.mutate({ item })}
                      >
                        {t("game.shop.buy", { price: formatPoints(item.price_cents) })}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Custom Rewards */}
      {activeTab === "custom" && (
        <div
          id={`${baseId}-panel-custom`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-custom`}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {atMaxCustomRewards ? (
              <p className="text-xs font-medium text-muted-foreground">
                {t("game.shop.maxRewardsReached")}
              </p>
            ) : (
              <span />
            )}
            <Button
              type="button"
              size="sm"
              disabled={atMaxCustomRewards}
              onClick={() => {
                setEditingReward(null);
                setRewardDialogOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("game.rewards.new")}
            </Button>
          </div>

          {rewardsQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-xl border border-border bg-card"
                />
              ))}
            </div>
          ) : rewardsQuery.isError ? (
            <div className="space-y-2 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
              <p>{t("game.error")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void rewardsQuery.refetch()}
              >
                {t("game.retry")}
              </Button>
            </div>
          ) : rewards.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title={t("game.shop.tabCustom")}
              description={t("game.rewards.empty")}
              action={
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setEditingReward(null);
                    setRewardDialogOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {t("game.rewards.new")}
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {rewards.map((reward) => {
                const shortfall = Math.max(0, reward.cost_cents - availableGold);
                const insufficient = shortfall > 0;
                const shortfallText = insufficient
                  ? t("game.shop.needGold", { missing: formatPoints(shortfall) })
                  : undefined;

                return (
                  <article
                    key={reward.id}
                    data-testid={`custom-reward-${reward.id}`}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/40 text-primary">
                        <RewardIconGlyph iconKey={reward.icon_key} className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 dir="auto" className="text-sm font-semibold text-foreground">
                          {reward.title}
                        </h3>
                        {reward.notes.trim().length > 0 && (
                          <p dir="auto" className="text-xs text-muted-foreground">
                            {reward.notes}
                          </p>
                        )}
                        {reward.claim_count > 0 && (
                          <p className="tnum text-[11px] text-muted-foreground">
                            {tn("game.rewards.claimedCount", reward.claim_count)}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label={t("game.rewards.edit")}
                          onClick={() => {
                            setEditingReward(reward);
                            setRewardDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          aria-label={t("game.rewards.delete")}
                          onClick={() => setDeletingReward(reward)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                      <span className="tnum inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--game-gold))]">
                        <GoldIcon className="size-3.5 shrink-0" />
                        {formatCurrency(reward.cost_cents, "game")}
                      </span>

                      {insufficient ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled
                          title={shortfallText}
                        >
                          {shortfallText}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={claimRewardMut.isPending}
                          onClick={() => claimRewardMut.mutate({ reward })}
                        >
                          {t("game.rewards.claim")}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Purchase History */}
      {activeTab === "history" && (
        <div
          id={`${baseId}-panel-history`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-history`}
        >
          {historyQuery.isLoading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl border border-border bg-card"
                />
              ))}
            </div>
          ) : historyQuery.isError ? (
            <div className="space-y-2 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
              <p>{t("game.error")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void historyQuery.refetch()}
              >
                {t("game.retry")}
              </Button>
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              {t("game.shop.historyEmpty")}
            </div>
          ) : (
            <ul className="space-y-2.5">
              {history.map((entry: SpendHistoryEntryDto) => {
                const displayLabel = spendEntryLabel(entry);
                const canRefund = entry.refundable && nowMs - entry.created_at <= REFUND_WINDOW_MS;

                return (
                  <li
                    key={entry.spend_id}
                    data-testid={`spend-history-${entry.spend_id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p dir="auto" className="text-sm font-medium text-foreground">
                        {displayLabel}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(entry.created_at, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="tnum text-sm font-semibold text-[hsl(var(--game-gold))]">
                        -{formatCurrency(entry.amount_cents, "game")}
                      </span>
                      {canRefund && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={refundMut.isPending}
                          onClick={() =>
                            refundMut.mutate({
                              spendId: entry.spend_id,
                              label: displayLabel,
                              amountCents: entry.amount_cents,
                            })
                          }
                        >
                          <RotateCcw className="size-3.5" />
                          {t("game.shop.refund")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {rewardDialogOpen && (
        <CustomRewardDialog
          key={editingReward?.id ?? "new"}
          open={true}
          reward={editingReward}
          nextSortOrder={rewards.length + 1}
          onSubmit={async (input) => {
            if (editingReward) {
              await updateRewardMut.mutateAsync({ id: editingReward.id, input });
            } else {
              await createRewardMut.mutateAsync(input);
            }
          }}
          onClose={() => {
            setRewardDialogOpen(false);
            setEditingReward(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deletingReward !== null}
        title={t("game.shop.deleteRewardTitle")}
        description={t("game.shop.deleteRewardConfirm", { title: deletingReward?.title ?? "" })}
        confirmLabel={t("game.rewards.delete")}
        cancelLabel={t("game.rewards.cancel")}
        isPending={deleteRewardMut.isPending}
        onConfirm={() => {
          if (deletingReward) {
            deleteRewardMut.mutate(deletingReward.id);
          }
        }}
        onCancel={() => setDeletingReward(null)}
      />
    </div>
  );
}
