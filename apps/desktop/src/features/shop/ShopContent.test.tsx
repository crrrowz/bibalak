import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomRewardDto,
  GameStateDto,
  PurchaseResultDto,
  ShopItemDto,
  SpendHistoryEntryDto,
} from "@bibalak/ipc-types";
import { Toaster } from "@/components/ui/toast";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import * as styleAudioModule from "@/lib/styleAudio";
import { useStyle } from "@/stores/style";
import { useToastStore } from "@/stores/toast";
import {
  initNotificationsFromStorage,
  useNotificationStore,
} from "@/features/notifications/notificationStore";
import { NotificationEventWatcher } from "@/features/notifications/NotificationEventWatcher";
import { ShopScreen } from "@/routes/ShopScreen";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

const BASE_CATALOG: ShopItemDto[] = [
  {
    item_key: "streak_freeze",
    slot: null,
    kind: "freeze_token",
    price_cents: 2_500,
    hide_hair: false,
    two_handed: false,
    owned: false,
    equipped: false,
  },
  {
    item_key: "head_hood_scholar",
    slot: "head",
    kind: "cosmetic",
    price_cents: 2_500,
    hide_hair: true,
    two_handed: false,
    owned: false,
    equipped: false,
  },
  {
    item_key: "head_hat_adventurer",
    slot: "head",
    kind: "cosmetic",
    price_cents: 4_500,
    hide_hair: false,
    two_handed: false,
    owned: false,
    equipped: false,
  },
  {
    item_key: "outfit_cloak_green",
    slot: "outfit",
    kind: "cosmetic",
    price_cents: 3_000,
    hide_hair: false,
    two_handed: false,
    owned: true,
    equipped: true,
  },
];

function makeGameState(overrides?: Partial<GameStateDto>): GameStateDto {
  return {
    level: 4,
    xp_into_level: 120,
    xp_to_next_level: 250,
    total_xp: 570,
    earned_gold_cents: 3_000,
    spent_gold_cents: 0,
    available_gold_cents: 3_000,
    study_streak: 6,
    studied_today: true,
    freeze_tokens_held: 1,
    freeze_token_cap: 3,
    avatar: {
      body_tone: "tone_1",
      hair_style: "hair_1",
      hair_color: "black",
      starter_outfit: "tunic_slate",
      starter_accessory: "none",
    },
    equipped: [
      { slot: "head", item_key: null },
      { slot: "outfit", item_key: "outfit_cloak_green" },
      { slot: "main_hand", item_key: null },
      { slot: "off_hand", item_key: null },
      { slot: "back", item_key: null },
      { slot: "accessory", item_key: null },
      { slot: "backdrop", item_key: null },
      { slot: "frame", item_key: null },
    ],
    owned_item_keys: ["outfit_cloak_green"],
    catalog: BASE_CATALOG.map((item) => ({ ...item })),
    ...overrides,
  };
}

function renderShop() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShopScreen />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("ShopScreen (14f)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useToastStore.getState().clear();
    initNotificationsFromStorage();
    setLocale("en");
    useStyle.getState().setStyle("game");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useToastStore.getState().clear();
    initNotificationsFromStorage();
    setLocale("en");
    vi.useRealTimers();
  });

  it("shows shortfall when gold is insufficient and updates gold and owned state on buy", async () => {
    const user = userEvent.setup();
    let state = makeGameState({ available_gold_cents: 3_000 });
    let history: SpendHistoryEntryDto[] = [];

    vi.spyOn(ipcModule.ipc, "getGameState").mockImplementation(async () => state);
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockImplementation(async () => history);
    const cueSpy = vi.spyOn(styleAudioModule, "playStyleCue");
    const equipSpy = vi
      .spyOn(ipcModule.ipc, "equipGameItem")
      .mockImplementation(async (slot, key) => {
        state = {
          ...state,
          equipped: state.equipped.map((e) => (e.slot === slot ? { ...e, item_key: key } : e)),
          catalog: state.catalog.map((c) => (c.item_key === key ? { ...c, equipped: true } : c)),
        };
        return state;
      });
    const buySpy = vi
      .spyOn(ipcModule.ipc, "buyShopItem")
      .mockImplementation(async (itemKey, _txId): Promise<PurchaseResultDto> => {
        state = {
          ...state,
          spent_gold_cents: 2_500,
          available_gold_cents: 500,
          owned_item_keys: [...state.owned_item_keys, itemKey],
          catalog: state.catalog.map((c) => (c.item_key === itemKey ? { ...c, owned: true } : c)),
        };
        history = [
          {
            spend_id: "spend-1",
            kind: "cosmetic",
            ref_key: itemKey,
            label: itemKey,
            amount_cents: 2_500,
            created_at: Date.now(),
            refundable: true,
          },
        ];
        return { spend_id: "spend-1", state };
      });

    renderShop();

    // Insufficient gold on Felt Brim Hat (45 gold vs 30 gold available -> shortfall 15)
    const hatCard = await screen.findByTestId("shop-item-head_hat_adventurer");
    const hatBuyBtn = within(hatCard).getByRole("button", { name: /Need 15 more gold/i });
    expect(hatBuyBtn).toBeDisabled();

    // Owned/Equipped item shows Owned badge
    const cloakCard = screen.getByTestId("shop-item-outfit_cloak_green");
    expect(within(cloakCard).getByText("Owned")).toBeInTheDocument();
    expect(within(cloakCard).getByRole("button", { name: /Equipped/i })).toBeInTheDocument();

    // Buy Traveller Hood (25 gold)
    const hoodCard = screen.getByTestId("shop-item-head_hood_scholar");
    await user.click(within(hoodCard).getByRole("button", { name: /Buy \(25 gold\)/i }));

    await waitFor(() =>
      expect(buySpy).toHaveBeenCalledWith(
        "head_hood_scholar",
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      ),
    );
    expect(cueSpy).toHaveBeenCalledWith("purchase");

    // Header balance updates to 5 gold and hood becomes Owned with Equip button
    expect(await screen.findByTestId("shop-gold-balance")).toHaveTextContent("5 gold");
    expect(within(hoodCard).getByText("Owned")).toBeInTheDocument();
    const equipBtn = within(hoodCard).getByRole("button", { name: /^Equip$/i });
    await user.click(equipBtn);
    await waitFor(() => expect(equipSpy).toHaveBeenCalledWith("head", "head_hood_scholar"));

    // Purchase goes to the notification centre (16h) with a Refund action
    await waitFor(() =>
      expect(
        useNotificationStore
          .getState()
          .popupQueue.some(
            (p) => p.kind === "purchase" && /Purchased Traveller Hood/i.test(p.body),
          ),
      ).toBe(true),
    );
    const popup = useNotificationStore.getState().popupQueue.find((p) => p.kind === "purchase");
    expect(popup?.action?.label).toMatch(/Refund/i);
  });

  it("disables Streak Freeze purchase when 3 of 3 tokens are held", async () => {
    const state = makeGameState({
      available_gold_cents: 10_000,
      freeze_tokens_held: 3,
      freeze_token_cap: 3,
    });
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(state);
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockResolvedValue([]);

    renderShop();

    const freezeCard = await screen.findByTestId("shop-item-streak_freeze");
    expect(within(freezeCard).getByText(/3 of 3 held/i)).toBeInTheDocument();
    const btn = within(freezeCard).getByRole("button", { name: /Max held \(3\)/i });
    expect(btn).toBeDisabled();
  });

  it("supports custom reward CRUD (max 50) and claiming", async () => {
    const user = userEvent.setup();
    let state = makeGameState({ available_gold_cents: 5_000 });
    let rewards: CustomRewardDto[] = [
      {
        id: "r-1",
        title: "Coffee break",
        notes: "Single espresso",
        cost_cents: 1_500,
        icon_key: "coffee",
        sort_order: 1,
        claim_count: 0,
      },
    ];

    vi.spyOn(ipcModule.ipc, "getGameState").mockImplementation(async () => state);
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockImplementation(async () => rewards);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockResolvedValue([]);
    const cueSpy = vi.spyOn(styleAudioModule, "playStyleCue");

    const createSpy = vi
      .spyOn(ipcModule.ipc, "createCustomReward")
      .mockImplementation(async (input) => {
        const created: CustomRewardDto = {
          id: "r-2",
          title: input.title,
          notes: input.notes,
          cost_cents: input.cost_cents,
          icon_key: input.icon_key,
          sort_order: rewards.length + 1,
          claim_count: 0,
        };
        rewards = [...rewards, created];
        return created;
      });
    const updateSpy = vi
      .spyOn(ipcModule.ipc, "updateCustomReward")
      .mockImplementation(async (id, input) => {
        const updated: CustomRewardDto = {
          ...(rewards.find((r) => r.id === id) as CustomRewardDto),
          title: input.title,
          notes: input.notes,
          cost_cents: input.cost_cents,
          icon_key: input.icon_key,
        };
        rewards = rewards.map((r) => (r.id === id ? updated : r));
        return updated;
      });
    const deleteSpy = vi
      .spyOn(ipcModule.ipc, "deleteCustomReward")
      .mockImplementation(async (id) => {
        rewards = rewards.filter((r) => r.id !== id);
      });
    const claimSpy = vi
      .spyOn(ipcModule.ipc, "claimCustomReward")
      .mockImplementation(async (id, _txId) => {
        const reward = rewards.find((r) => r.id === id)!;
        rewards = rewards.map((r) => (r.id === id ? { ...r, claim_count: r.claim_count + 1 } : r));
        state = {
          ...state,
          available_gold_cents: state.available_gold_cents - reward.cost_cents,
        };
        return { spend_id: "spend-r1", state };
      });

    renderShop();

    await user.click(await screen.findByRole("tab", { name: /Custom Rewards/i }));

    // Create a reward
    await user.click(screen.getByRole("button", { name: /New reward/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reward title/i), "Watch one episode");
    const costInput = within(dialog).getByLabelText(/Cost \(gold\)/i);
    await user.clear(costInput);
    await user.type(costInput, "20");
    await user.type(within(dialog).getByLabelText(/Notes/i), "Evening break");
    await user.click(within(dialog).getByRole("button", { name: /Save/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Watch one episode",
          cost_cents: 2_000,
          notes: "Evening break",
        }),
      ),
    );

    const newCard = await screen.findByTestId("custom-reward-r-2");
    // Claim it
    await user.click(within(newCard).getByRole("button", { name: /Claim/i }));
    await waitFor(() =>
      expect(claimSpy).toHaveBeenCalledWith("r-2", expect.stringMatching(/^[0-9a-f-]{36}$/i)),
    );
    expect(cueSpy).toHaveBeenCalledWith("purchase");
    expect(await screen.findByTestId("shop-gold-balance")).toHaveTextContent("30 gold");

    // Edit the first reward
    const coffeeCard = screen.getByTestId("custom-reward-r-1");
    await user.click(within(coffeeCard).getByRole("button", { name: /Edit reward/i }));
    const editDialog = await screen.findByRole("dialog");
    const titleInput = within(editDialog).getByLabelText(/Reward title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Double espresso");
    await user.click(within(editDialog).getByRole("button", { name: /Save/i }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "r-1",
        expect.objectContaining({ title: "Double espresso" }),
      ),
    );

    // Delete the edited reward
    await user.click(
      within(screen.getByTestId("custom-reward-r-1")).getByRole("button", { name: /Delete/i }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("r-1"));
  });

  it("disables creating custom rewards when 50 rewards already exist", async () => {
    const fiftyRewards: CustomRewardDto[] = Array.from({ length: 50 }, (_, i) => ({
      id: `r-${i + 1}`,
      title: `Reward ${i + 1}`,
      notes: "",
      cost_cents: 500,
      icon_key: "gift",
      sort_order: i + 1,
      claim_count: 0,
    }));
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(makeGameState());
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockResolvedValue(fiftyRewards);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockResolvedValue([]);

    const user = userEvent.setup();
    renderShop();
    await user.click(await screen.findByRole("tab", { name: /Custom Rewards/i }));

    expect(screen.getByRole("button", { name: /New reward/i })).toBeDisabled();
    expect(screen.getByText(/Maximum of 50 custom rewards reached/i)).toBeInTheDocument();
  });

  it("offers Refund in Purchase History only within the 5-minute window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const baseNow = new Date("2026-11-24T12:00:00Z").getTime();
    vi.setSystemTime(baseNow);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let state = makeGameState({ available_gold_cents: 500, spent_gold_cents: 2_500 });
    let history: SpendHistoryEntryDto[] = [
      {
        spend_id: "spend-recent",
        kind: "cosmetic",
        ref_key: "head_hood_scholar",
        label: "head_hood_scholar",
        amount_cents: 2_500,
        created_at: baseNow - 60_000,
        refundable: true,
      },
      {
        spend_id: "spend-old",
        kind: "cosmetic",
        ref_key: "outfit_cloak_green",
        label: "outfit_cloak_green",
        amount_cents: 3_000,
        created_at: baseNow - 600_000,
        refundable: false,
      },
    ];

    vi.spyOn(ipcModule.ipc, "getGameState").mockImplementation(async () => state);
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockImplementation(async () => history);
    const refundSpy = vi
      .spyOn(ipcModule.ipc, "refundShopPurchase")
      .mockImplementation(async (id) => {
        history = history.filter((h) => h.spend_id !== id);
        state = makeGameState({ available_gold_cents: 3_000, spent_gold_cents: 0 });
        return state;
      });

    renderShop();

    await user.click(await screen.findByRole("tab", { name: /Purchase History/i }));

    const recentRow = await screen.findByTestId("spend-history-spend-recent");
    const oldRow = screen.getByTestId("spend-history-spend-old");
    expect(within(recentRow).getByRole("button", { name: /Refund/i })).toBeInTheDocument();
    expect(within(oldRow).queryByRole("button", { name: /Refund/i })).not.toBeInTheDocument();

    // Advance past the 5-minute window -> Refund disappears automatically
    act(() => {
      vi.advanceTimersByTime(241_000);
    });
    expect(within(recentRow).queryByRole("button", { name: /Refund/i })).not.toBeInTheDocument();

    // Reset clock within 5 minutes and test Refund click
    vi.setSystemTime(baseNow);
    await user.click(screen.getByRole("tab", { name: /Items/i }));
    await user.click(screen.getByRole("tab", { name: /Purchase History/i }));
    const freshRecent = await screen.findByTestId("spend-history-spend-recent");
    await user.click(within(freshRecent).getByRole("button", { name: /Refund/i }));
    await waitFor(() => expect(refundSpy).toHaveBeenCalledWith("spend-recent"));
    expect(await screen.findByTestId("shop-gold-balance")).toHaveTextContent("30 gold");
  });

  it("bw2_1_one_purchase_emits_exactly_one_notification_with_display_name_and_refund", async () => {
    const user = userEvent.setup();
    let state = makeGameState({ available_gold_cents: 5_000 });
    let history: SpendHistoryEntryDto[] = [];

    vi.spyOn(ipcModule.ipc, "getGameState").mockImplementation(async () => state);
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockImplementation(async () => history);
    vi.spyOn(ipcModule.ipc, "buyShopItem").mockImplementation(async (itemKey) => {
      state = {
        ...state,
        spent_gold_cents: 2_500,
        available_gold_cents: 2_500,
        owned_item_keys: [...state.owned_item_keys, itemKey],
        catalog: state.catalog.map((c) => (c.item_key === itemKey ? { ...c, owned: true } : c)),
      };
      history = [
        {
          spend_id: "spend-bw2-1",
          kind: "cosmetic",
          ref_key: itemKey,
          label: itemKey,
          amount_cents: 2_500,
          created_at: Date.now(),
          refundable: true,
        },
      ];
      return { spend_id: "spend-bw2-1", state };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationEventWatcher />
        <ShopScreen />
        <Toaster />
      </QueryClientProvider>,
    );

    const hoodCard = await screen.findByTestId("shop-item-head_hood_scholar");
    await user.click(within(hoodCard).getByRole("button", { name: /Buy \(25 gold\)/i }));

    await waitFor(() => {
      expect(
        useNotificationStore.getState().items.filter((i) => i.kind === "purchase"),
      ).toHaveLength(1);
    });
    // Wait for spendHistory refetch to complete so NotificationEventWatcher also ran
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.spendHistory)).toHaveLength(1);
    });

    const purchases = useNotificationStore.getState().items.filter((i) => i.kind === "purchase");
    expect(purchases).toHaveLength(1);
    expect(purchases[0]?.body).toContain("Traveller Hood");
    expect(purchases[0]?.body).not.toContain("head_hood_scholar");
    const popup = useNotificationStore.getState().popupQueue.find((p) => p.kind === "purchase");
    expect(popup?.action?.label).toMatch(/Refund/i);
  });

  it("A3-19: gates /shop in Default style and uses knowledge points instead of gold in Scholar style", async () => {
    useStyle.getState().setStyle("default");
    const gameSpy = vi.spyOn(ipcModule.ipc, "getGameState");
    const { rerender } = renderShop();
    expect(
      screen.getByText("The shop & custom rewards are available in Game style."),
    ).toBeInTheDocument();
    expect(gameSpy).not.toHaveBeenCalled();

    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(makeGameState());
    vi.spyOn(ipcModule.ipc, "listCustomRewards").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listSpendHistory").mockResolvedValue([]);
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ShopScreen />
      </QueryClientProvider>,
    );

    const balance = await screen.findByTestId("shop-gold-balance");
    expect(balance.textContent).toMatch(/knowledge points/i);
    expect(balance.textContent).not.toMatch(/\bgold\b/i);
  });
});
