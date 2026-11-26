import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateDto, ProgressSummaryDto } from "@bibalak/ipc-types";
import { mockGameState } from "@/dev/mocks/game";
import { mockGameDepthLv10, mockGameDepthStarter } from "@/dev/mocks/gameDepth";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { useStyle } from "@/stores/style";
import { CharacterContent } from "./CharacterContent";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeProgress(level = 4): ProgressSummaryDto {
  return {
    level,
    xp_into_level: 120,
    xp_to_next_level: 250,
    total_xp: 570,
    gold_cents: 4750,
    today_xp: 30,
    today_gold_cents: 250,
    tasks_rewarded_today: 2,
    task_reward_daily_cap: 10,
  };
}

function makeTwoHandedGameState(): GameStateDto {
  const base = structuredClone(mockGameState);
  return {
    ...base,
    owned_item_keys: [...base.owned_item_keys, "hand_staff_quill"],
    equipped: base.equipped.map((e) => {
      if (e.slot === "main_hand") return { slot: "main_hand", item_key: "hand_staff_quill" };
      if (e.slot === "off_hand") return { slot: "off_hand", item_key: "off_lantern_warm" };
      return e;
    }),
    catalog: base.catalog.map((item) => {
      if (item.item_key === "hand_staff_quill") return { ...item, owned: true, equipped: true };
      if (item.item_key === "off_lantern_warm") return { ...item, owned: true, equipped: true };
      return item;
    }),
  };
}

function renderCharacter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CharacterContent />
    </QueryClientProvider>,
  );
}

describe("CharacterContent (14e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("game");
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("edits free appearance immediately in Game and Scholar", async () => {
    const initial = structuredClone(mockGameState);
    const updatedProfile = { ...initial.avatar, body_tone: "tone_4", hair_color: "indigo" };

    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(initial);
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );
    const updateSpy = vi
      .spyOn(ipcModule.ipc, "updateAvatarProfile")
      .mockResolvedValue(updatedProfile);

    renderCharacter();

    expect(await screen.findByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Skin tone 4" }));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ body_tone: "tone_4" }));

    // Stage updates immediately with optimistic/returned profile
    const stage = screen.getByTestId("avatar-stage");
    expect(stage.querySelector("svg[data-layer='body']")).toHaveAttribute("data-item", "tone_4");

    // Active companion pet renders beside the avatar without RTL flip
    const petBadge = screen.getByTestId("character-companion");
    expect(petBadge).toHaveAttribute("dir", "ltr");
    expect(petBadge.querySelector("svg[data-layer='pet']")).toHaveAttribute(
      "data-item",
      "owl:classic",
    );
  });

  it("supports Game equip/unequip, two-handed hiding off-hand, slot filters, and keyboard tab switching", async () => {
    const twoHandedState = makeTwoHandedGameState();
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(twoHandedState);
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthLv10),
    );
    const equipSpy = vi.spyOn(ipcModule.ipc, "equipGameItem").mockResolvedValue(twoHandedState);
    const unequipSpy = vi
      .spyOn(ipcModule.ipc, "unequipGameSlot")
      .mockResolvedValue(structuredClone(mockGameState));

    renderCharacter();

    expect(await screen.findByText("Two-handed item hides off-hand slot")).toBeInTheDocument();
    const stage = screen.getByTestId("avatar-stage");
    expect(stage.querySelector("svg[data-layer='main_hand']")).toHaveAttribute(
      "data-item",
      "hand_staff_quill",
    );
    expect(stage.querySelector("svg[data-layer='off_hand']")).toBeNull();

    // Unequip button on equipment slot chip
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Unequip Main hand" }));
    expect(unequipSpy).toHaveBeenCalledWith("main_hand");

    // Keyboard navigation between tabs (Appearance -> Wardrobe -> Stable -> Paths -> Achievements)
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    appearanceTab.focus();
    await user.keyboard("{ArrowRight}");
    const wardrobeTab = screen.getByRole("tab", { name: "Wardrobe" });
    expect(wardrobeTab).toHaveFocus();
    expect(wardrobeTab).toHaveAttribute("aria-selected", "true");

    // Filter Wardrobe by Head slot and equip Traveller Hood
    const filterGroup = screen.getByRole("group", { name: "Filter by slot" });
    await user.click(within(filterGroup).getByRole("button", { name: "Head" }));
    const tabPanel = screen.getByRole("tabpanel");
    expect(within(tabPanel).getByText("Traveller Hood")).toBeInTheDocument();
    expect(within(tabPanel).queryByText("Forest Cloak")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Equip" }));
    expect(equipSpy).toHaveBeenCalledWith("head", "head_hood_scholar");
  });

  it("renders Scholar title outfit, next title preview, and academic achievements only", async () => {
    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(structuredClone(mockGameState));
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress(4));
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );
    const scholarUpdateSpy = vi
      .spyOn(ipcModule.ipc, "updateAvatarProfile")
      .mockResolvedValue({ ...mockGameState.avatar, hair_color: "auburn" });

    renderCharacter();

    expect(await screen.findByText("Current regalia")).toBeInTheDocument();
    expect(screen.getByText("Next rank preview")).toBeInTheDocument();
    expect(screen.getByText("Researcher · Level 5")).toBeInTheDocument();

    // Scholar has Appearance + Achievements tabs only (no Wardrobe, Stable, Paths)
    expect(screen.getByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Achievements" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Wardrobe" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Stable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Paths" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Auburn" }));
    expect(scholarUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hair_color: "auburn" }),
    );
    await user.click(screen.getByRole("tab", { name: "Achievements" }));
    expect(await screen.findByText("Academic Milestones")).toBeInTheDocument();
    expect(screen.getByText("First Assignment Done")).toBeInTheDocument();
  });

  it("bw2_2_wardrobe_cards_render_gear_preview_including_frames_and_backdrops", async () => {
    const base = structuredClone(mockGameState);
    const state: GameStateDto = {
      ...base,
      owned_item_keys: [
        "head_hood_scholar",
        "outfit_cloak_green",
        "frame_copper_ring",
        "bg_night_library",
      ],
      equipped: base.equipped.map((e) =>
        e.slot === "outfit" ? { ...e, item_key: "outfit_cloak_green" } : { ...e, item_key: null },
      ),
    };
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(state);
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );

    const user = userEvent.setup();
    renderCharacter();

    await user.click(await screen.findByRole("tab", { name: "Wardrobe" }));

    for (const key of state.owned_item_keys) {
      const preview = screen.getByTestId(`gear-preview-${key}`);
      expect(preview).toBeInTheDocument();
      expect(within(preview).getByTestId("avatar-stage")).toBeInTheDocument();
    }

    const framePreview = screen.getByTestId("gear-preview-frame_copper_ring");
    expect(framePreview.querySelector("svg[data-layer='frame']")).toHaveAttribute(
      "data-item",
      "frame_copper_ring",
    );

    const backdropPreview = screen.getByTestId("gear-preview-bg_night_library");
    expect(backdropPreview.querySelector("svg[data-layer='backdrop']")).toHaveAttribute(
      "data-item",
      "bg_night_library",
    );
  });
});
