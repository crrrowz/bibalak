import { beforeEach, describe, expect, it, vi } from "vitest";
import { installPreviewMocks } from "@/dev/previewMocks";
import { setLocale } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";

describe("ipc AI locale forwarding (AI1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the current app locale on aiPreviewAction and aiRunAction", async () => {
    setLocale("ar");
    const invokeSpy = vi.spyOn(platform, "invoke").mockResolvedValue({} as never);
    const action = {
      kind: "explain-card" as const,
      front_html: "1234",
      back_html: "5678",
      deck_name: null,
    };

    try {
      await ipc.aiPreviewAction(action);
      await ipc.aiRunAction(action);

      expect(invokeSpy).toHaveBeenNthCalledWith(1, "ai_preview_action", {
        action,
        appLocale: "ar",
      });
      expect(invokeSpy).toHaveBeenNthCalledWith(2, "ai_run_action", {
        action,
        appLocale: "ar",
      });
    } finally {
      setLocale("en");
    }
  });
});

describe("ipc progressSummary (R1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes progress_summary and returns the ProgressSummaryDto from previewMocks", async () => {
    installPreviewMocks();
    const summary = await ipc.progressSummary();
    expect(summary).toEqual({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      gold_cents: 4750,
      today_xp: 45,
      today_gold_cents: 375,
      tasks_rewarded_today: 2,
      task_reward_daily_cap: 10,
    });
  });

  it("invokes progress_history, study_days, and progress_by_deck against previewMocks", async () => {
    installPreviewMocks();
    const history = await ipc.progressHistory();
    const days = await ipc.studyDays(30);
    const byDeck = await ipc.progressByDeck();

    expect(history.length).toBeGreaterThan(0);
    expect(days.length).toBeGreaterThan(0);
    expect(byDeck.length).toBeGreaterThan(0);
  });

  it("Z1b: invokes legacy_media_pending against previewMocks", async () => {
    installPreviewMocks();
    const pending = await ipc.legacyMediaPending();
    expect(pending).toBe(false);
  });
});

describe("ipc productivity wrappers (M1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes task list, matrix, habit, and calendar commands with camelCase argument keys", async () => {
    const invokeSpy = vi.spyOn(platform, "invoke").mockResolvedValue([] as never);

    await ipc.listTaskLists();
    expect(invokeSpy).toHaveBeenLastCalledWith("list_task_lists", undefined);

    await ipc.getMatrixBoard(true);
    expect(invokeSpy).toHaveBeenLastCalledWith("get_matrix_board", { includeCompleted: true });

    await ipc.getHabitBoard(14);
    expect(invokeSpy).toHaveBeenLastCalledWith("get_habit_board", {
      weekStartDay: 14,
      weekStart: null,
    });

    await ipc.getHabitBoard(14, "sat");
    expect(invokeSpy).toHaveBeenLastCalledWith("get_habit_board", {
      weekStartDay: 14,
      weekStart: "sat",
    });

    await ipc.getHabitHistory("h-1", 6, "sun");
    expect(invokeSpy).toHaveBeenLastCalledWith("get_habit_history", {
      habitId: "h-1",
      months: 6,
      weekStart: "sun",
    });

    await ipc.listArchivedHabits();
    expect(invokeSpy).toHaveBeenLastCalledWith("list_archived_habits", undefined);

    await ipc.reorderTasks([{ id: "t-1", sort_order: 10 }]);
    expect(invokeSpy).toHaveBeenLastCalledWith("reorder_tasks", {
      items: [{ id: "t-1", sort_order: 10 }],
    });

    await ipc.rescheduleOverdueTasks("2026-11-24");
    expect(invokeSpy).toHaveBeenLastCalledWith("reschedule_overdue_tasks", {
      targetDate: "2026-11-24",
    });

    await ipc.listCalendarOccurrences(1_000, 2_000);
    expect(invokeSpy).toHaveBeenLastCalledWith("list_calendar_occurrences", {
      windowStartMs: 1_000,
      windowEndMs: 2_000,
    });

    await ipc.deleteCalendarOccurrence("ev-1", "2026-11-22");
    expect(invokeSpy).toHaveBeenLastCalledWith("delete_calendar_occurrence", {
      id: "ev-1",
      occurrenceDate: "2026-11-22",
    });
  });
});

describe("ipc game & game depth wrappers + previewMocks (14d)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes all 17 game commands with expected names and camelCase args", async () => {
    const invokeSpy = vi.spyOn(platform, "invoke").mockResolvedValue([] as never);

    await ipc.getGameState();
    expect(invokeSpy).toHaveBeenLastCalledWith("get_game_state", undefined);

    await ipc.updateAvatarProfile({
      body_tone: "tone_2",
      hair_style: "hair_2",
      hair_color: "brown",
      starter_outfit: "tunic_forest",
      starter_accessory: "acc_glasses",
    });
    expect(invokeSpy).toHaveBeenLastCalledWith("update_avatar_profile", {
      input: {
        body_tone: "tone_2",
        hair_style: "hair_2",
        hair_color: "brown",
        starter_outfit: "tunic_forest",
        starter_accessory: "acc_glasses",
      },
    });

    await ipc.equipGameItem("head", "head_hood_scholar");
    expect(invokeSpy).toHaveBeenLastCalledWith("equip_game_item", {
      slot: "head",
      itemKey: "head_hood_scholar",
    });

    await ipc.unequipGameSlot("head");
    expect(invokeSpy).toHaveBeenLastCalledWith("unequip_game_slot", { slot: "head" });

    await ipc.buyShopItem("head_hat_adventurer", "tx-1");
    expect(invokeSpy).toHaveBeenLastCalledWith("buy_shop_item", {
      itemKey: "head_hat_adventurer",
      clientTxId: "tx-1",
    });

    await ipc.refundShopPurchase("spend-1");
    expect(invokeSpy).toHaveBeenLastCalledWith("refund_shop_purchase", { spendId: "spend-1" });

    await ipc.listCustomRewards();
    expect(invokeSpy).toHaveBeenLastCalledWith("list_custom_rewards", undefined);

    await ipc.createCustomReward({
      title: "Break",
      notes: "",
      cost_cents: 1500,
      icon_key: "coffee",
      sort_order: null,
    });
    expect(invokeSpy).toHaveBeenLastCalledWith("create_custom_reward", {
      input: {
        title: "Break",
        notes: "",
        cost_cents: 1500,
        icon_key: "coffee",
        sort_order: null,
      },
    });

    await ipc.updateCustomReward("rw-1", {
      title: "Break 2",
      notes: "ok",
      cost_cents: 2000,
      icon_key: "tea" as never,
      sort_order: 1,
    });
    expect(invokeSpy).toHaveBeenLastCalledWith("update_custom_reward", {
      id: "rw-1",
      input: {
        title: "Break 2",
        notes: "ok",
        cost_cents: 2000,
        icon_key: "tea",
        sort_order: 1,
      },
    });

    await ipc.deleteCustomReward("rw-1");
    expect(invokeSpy).toHaveBeenLastCalledWith("delete_custom_reward", { id: "rw-1" });

    await ipc.claimCustomReward("rw-1", "tx-2");
    expect(invokeSpy).toHaveBeenLastCalledWith("claim_custom_reward", {
      id: "rw-1",
      clientTxId: "tx-2",
    });

    await ipc.listSpendHistory(25);
    expect(invokeSpy).toHaveBeenLastCalledWith("list_spend_history", { limit: 25 });

    await ipc.getGameDepthState();
    expect(invokeSpy).toHaveBeenLastCalledWith("get_game_depth_state", undefined);

    await ipc.chooseGamePath("sage");
    expect(invokeSpy).toHaveBeenLastCalledWith("choose_game_path", { pathId: "sage" });

    await ipc.setActivePet("pet-1", true);
    expect(invokeSpy).toHaveBeenLastCalledWith("set_active_pet", {
      petId: "pet-1",
      mounted: true,
    });

    await ipc.acknowledgeUnlocks(["u-1"]);
    expect(invokeSpy).toHaveBeenLastCalledWith("acknowledge_unlocks", { unlockIds: ["u-1"] });

    await ipc.runUnlockBackfill();
    expect(invokeSpy).toHaveBeenLastCalledWith("run_unlock_backfill", undefined);
  });

  it("wires game and gameDepth preview mocks for all 17 commands", async () => {
    installPreviewMocks();
    const state = await ipc.getGameState();
    expect(state.level).toBe(4);
    expect(state.available_gold_cents).toBe(4750);
    expect(state.catalog).toHaveLength(25);

    const rewards = await ipc.listCustomRewards();
    expect(rewards.length).toBeGreaterThanOrEqual(2);

    const depth = await ipc.getGameDepthState();
    expect(depth.achievements).toHaveLength(25);
    expect(depth.pets.length).toBeGreaterThanOrEqual(2);
  });
});
