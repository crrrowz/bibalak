import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaLibraryScreen } from "./MediaLibraryScreen";
import * as ipcModule from "@/lib/ipc";
import { MEDIA_PAGE_SIZE, mediaUrl } from "@/lib/media";
import { setLocale } from "@/lib/i18n";
import { useSound } from "@/stores/sound";
import type { DeckSummary, MediaLibraryFilter, MediaLibraryPage } from "@bibalak/ipc-types";

const navigateMock = vi.fn();

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function renderScreen(staleTime = 0) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MediaLibraryScreen />
      </QueryClientProvider>,
    ),
  };
}

const samplePage: MediaLibraryPage = {
  items: [
    { filename: "heart-diagram.png", size_bytes: 2048, kind: "image", usage_count: 2 },
    { filename: "pronunciation.mp3", size_bytes: 15360, kind: "audio", usage_count: 1 },
    { filename: "lecture-clip.mp4", size_bytes: 2097152, kind: "video", usage_count: 0 },
  ],
  total_count: 3,
  library_count: 3,
  unused_count: 1,
  total_bytes: 2048 + 15360 + 2097152,
};

const sampleDecks: DeckSummary[] = [
  {
    id: 1,
    name: "Spanish",
    parent_id: null,
    new_count: 5,
    learning_count: 0,
    review_count: 10,
    is_filtered: false,
    collapsed: false,
  },
  {
    id: 2,
    name: "Medicine::Heart Lab",
    parent_id: null,
    new_count: 2,
    learning_count: 0,
    review_count: 4,
    is_filtered: false,
    collapsed: false,
  },
  {
    id: 3,
    name: "Exam cram",
    parent_id: null,
    new_count: 0,
    learning_count: 0,
    review_count: 0,
    is_filtered: true,
    collapsed: false,
  },
];

describe("MediaLibraryScreen (E5 / M0)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
    setLocale("en");
  });

  function mockDecksAndTags(legacyMediaPending = false) {
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue(sampleDecks);
    vi.spyOn(ipcModule.ipc, "listTags").mockResolvedValue(["verbs", "cardiology::ecg"]);
    vi.spyOn(ipcModule.ipc, "legacyMediaPending").mockResolvedValue(legacyMediaPending);
  }

  it("renders image previews via bibalak-media protocol, audio/video labels, sizes, and usage counts", async () => {
    mockDecksAndTags();
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    renderScreen();

    const img = await screen.findByAltText("heart-diagram.png");
    expect(img).toHaveAttribute("src", mediaUrl("heart-diagram.png"));

    expect(screen.getAllByText("Audio").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Video").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByText("Unused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unused \(1\)/i })).toBeInTheDocument();
  });

  it("clicking a tile opens the preview panel without navigating, plays one media at a time, closes on Escape returning focus, and navigates via Show notes using it", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    renderScreen();

    const imageTile = await screen.findByRole("button", {
      name: /Preview heart-diagram\.png/i,
    });
    imageTile.focus();
    await user.click(imageTile);

    // Selecting does not navigate immediately.
    expect(navigateMock).not.toHaveBeenCalled();

    const preview = await screen.findByRole("region", { name: /Media preview/i });
    expect(preview).toHaveTextContent("heart-diagram.png");
    expect(preview).toHaveTextContent("2 KB");
    expect(preview).toHaveTextContent("2 notes");
    expect(preview.querySelector("img")).toHaveAttribute("src", mediaUrl("heart-diagram.png"));

    // Navigate explicitly via "Show notes using it".
    await user.click(screen.getByRole("button", { name: /Show notes using it/i }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/browse",
      search: { q: '"heart-diagram.png"' },
    });

    // Switch selection to audio tile -> mounts custom audio player without native controls.
    const audioTile = screen.getByRole("button", { name: /Preview pronunciation\.mp3/i });
    await user.click(audioTile);
    const audioEl = preview.querySelector("audio");
    expect(audioEl).not.toBeNull();
    expect(audioEl).toHaveAttribute("src", mediaUrl("pronunciation.mp3"));
    expect(audioEl).not.toHaveAttribute("controls");

    // Escape closes preview panel, pauses audio, and returns focus to the selected tile.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /Media preview/i })).not.toBeInTheDocument();
    });
    expect(pauseSpy).toHaveBeenCalled();
    expect(audioTile).toHaveFocus();
  });

  it("filters by deck, tag, kind, usage, and sort with Browse query quoting and resets page to 1", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();
    const listSpy = vi
      .spyOn(ipcModule.ipc, "listMediaLibrary")
      .mockResolvedValue({ ...samplePage, total_count: MEDIA_PAGE_SIZE + 5 });

    renderScreen();
    await screen.findByAltText("heart-diagram.png");

    // Go to page 2 first so we can verify filter changes reset offset to 0.
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        MEDIA_PAGE_SIZE,
        expect.objectContaining({ query: "", kind: null, usage: "all", sort: "name" }),
      );
    });

    // Filtered deck ("Exam cram") must not be listed in deck filter.
    const deckSelect = screen.getByRole("combobox", { name: /Deck/i });
    expect(deckSelect).not.toHaveTextContent("Exam cram");
    await user.selectOptions(deckSelect, "Medicine::Heart Lab");

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        0,
        expect.objectContaining<Partial<MediaLibraryFilter>>({
          query: 'deck:"Medicine::Heart Lab"',
        }),
      );
    });

    const tagSelect = screen.getByRole("combobox", { name: /Tag/i });
    await user.selectOptions(tagSelect, "cardiology::ecg");
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        0,
        expect.objectContaining<Partial<MediaLibraryFilter>>({
          query: 'deck:"Medicine::Heart Lab" tag:cardiology::ecg',
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: /^Audio$/i }));
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        0,
        expect.objectContaining<Partial<MediaLibraryFilter>>({ kind: "audio" }),
      );
    });

    const usageGroup = screen.getByRole("group", { name: /Usage/i });
    await user.click(within(usageGroup).getByRole("button", { name: /Unused/i }));
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        0,
        expect.objectContaining<Partial<MediaLibraryFilter>>({ usage: "unused" }),
      );
    });

    await user.selectOptions(screen.getByRole("combobox", { name: /Sort by/i }), "size-desc");
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        0,
        expect.objectContaining<Partial<MediaLibraryFilter>>({ sort: "size-desc" }),
      );
    });
  });

  it("searches by name and pages through large libraries", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();
    const listSpy = vi
      .spyOn(ipcModule.ipc, "listMediaLibrary")
      .mockImplementation(async (search, _limit, offset) => ({
        items: [
          {
            filename: search ? `match-${search}.png` : `file-${offset}.png`,
            size_bytes: 1024,
            kind: "image",
            usage_count: 1,
          },
        ],
        total_count: search ? 1 : MEDIA_PAGE_SIZE + 5,
        library_count: MEDIA_PAGE_SIZE + 5,
        unused_count: 0,
        total_bytes: 1024,
      }));

    renderScreen();
    await screen.findByAltText("file-0.png");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith("", MEDIA_PAGE_SIZE, MEDIA_PAGE_SIZE, expect.anything());
    });

    const searchInput = screen.getByRole("searchbox", { name: "Search media files" });
    await user.type(searchInput, "beta");
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith("beta", MEDIA_PAGE_SIZE, 0, expect.anything());
    });
  });

  it("prompts with count and trash wording before moving unused media to trash", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    const deleteSpy = vi.spyOn(ipcModule.ipc, "deleteUnusedMedia").mockResolvedValue(1);

    renderScreen();
    const deleteBtn = await screen.findByRole("button", { name: /Move to trash \(1\)/i });
    await user.click(deleteBtn);

    expect(
      screen.getByText(
        "Move 1 unused media file from your media folder to trash? Files used by any card or template are never touched.",
      ),
    ).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: "Move unused media to trash" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Moved 1 unused file to trash.")).toBeInTheDocument();
  });

  it("renders translated Arabic copy in RTL mode", async () => {
    setLocale("ar");
    mockDecksAndTags();
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    renderScreen();

    expect(document.documentElement.dir).toBe("rtl");
    expect(await screen.findByRole("heading", { name: "مكتبة الوسائط" })).toBeInTheDocument();
    await screen.findByAltText("heart-diagram.png");
    expect(screen.getByRole("combobox", { name: "المجموعة" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "الوسم" })).toBeInTheDocument();
    expect(screen.getAllByText("صوت").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("فيديو").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("غير مستخدم")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /غير مستخدم/i })).toBeInTheDocument();
  });

  it("OT-12: renders custom audio player with play/pause, timeline seek and arrow keys, time text, app volume, and error state without native controls", async () => {
    const user = userEvent.setup();
    useSound.setState({ volume: 60, muted: false, effectiveVolume: 0.6 });
    mockDecksAndTags();
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    renderScreen();

    const audioTile = await screen.findByRole("button", { name: /Preview pronunciation\.mp3/i });
    await user.click(audioTile);

    const preview = await screen.findByRole("region", { name: /Media preview/i });
    const audioEl = preview.querySelector("audio") as HTMLAudioElement;
    expect(audioEl).not.toBeNull();
    expect(audioEl).not.toHaveAttribute("controls");
    expect(audioEl.volume).toBeCloseTo(0.6);

    // Simulate duration and currentTime loaded
    Object.defineProperty(audioEl, "duration", { value: 25, writable: true });
    Object.defineProperty(audioEl, "currentTime", { value: 7, writable: true });
    fireEvent.loadedMetadata(audioEl);
    fireEvent.timeUpdate(audioEl);

    expect(preview).toHaveTextContent("0:07 / 0:25");

    const slider = screen.getByRole("slider", { name: /timeline/i });
    expect(slider).toHaveAttribute("aria-valuetext", "0:07");

    // Seek via slider change
    fireEvent.change(slider, { target: { value: "12" } });
    expect(audioEl.currentTime).toBe(12);
    expect(preview).toHaveTextContent("0:12 / 0:25");

    // Seek via ArrowRight / ArrowLeft keys
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(audioEl.currentTime).toBe(17);

    // Play / pause toggle
    const playBtn = screen.getByRole("button", { name: /^Play$/i });
    await user.click(playBtn);
    expect(playSpy).toHaveBeenCalled();
    fireEvent.play(audioEl);

    const pauseBtn = screen.getByRole("button", { name: /^Pause$/i });
    await user.click(pauseBtn);
    expect(pauseSpy).toHaveBeenCalled();
    fireEvent.pause(audioEl);

    // Error state when file fails to load
    fireEvent.error(audioEl);
    expect(await screen.findByText(/Could not play audio file/i)).toBeInTheDocument();
  });

  it("H1: All tab refreshes after switching from Audio instead of serving a stale partial cache", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();

    let mediaReady = false;
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockImplementation(
      async (_search, _limit, _offset, filter) => {
        const allItems = mediaReady
          ? [
              {
                filename: "heart-diagram.png",
                size_bytes: 2048,
                kind: "image" as const,
                usage_count: 2,
              },
              {
                filename: "pronunciation.mp3",
                size_bytes: 15360,
                kind: "audio" as const,
                usage_count: 1,
              },
            ]
          : [
              {
                filename: "heart-diagram.png",
                size_bytes: 2048,
                kind: "image" as const,
                usage_count: 2,
              },
            ];
        const items = filter?.kind ? allItems.filter((i) => i.kind === filter.kind) : allItems;
        return {
          items,
          total_count: items.length,
          library_count: allItems.length,
          unused_count: 0,
          total_bytes: items.reduce((sum, i) => sum + i.size_bytes, 0),
        };
      },
    );

    // Use the app's 30s staleTime (see app/providers.tsx) to reproduce the stale All-tab cache.
    renderScreen(30_000);
    await screen.findByAltText("heart-diagram.png");
    expect(screen.queryByText("pronunciation.mp3")).not.toBeInTheDocument();

    // Media finishes populating; user visits Audio tab and sees the audio file, then returns to All.
    mediaReady = true;
    await user.click(screen.getByRole("button", { name: /^Audio$/i }));
    expect(await screen.findByText("pronunciation.mp3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All$/i }));
    expect(await screen.findByText("pronunciation.mp3")).toBeInTheDocument();
  });

  it("Z1b: disables Move to trash with notice while legacy copy is pending, enabled when idle", async () => {
    mockDecksAndTags(true);
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    const { unmount } = renderScreen();

    const deleteBtn = await screen.findByRole("button", { name: /Move to trash \(1\)/i });
    await waitFor(() => expect(deleteBtn).toBeDisabled());
    expect(
      screen.getByText(
        "Media from the old app folder is still being copied. Cleanup is available when it finishes.",
      ),
    ).toBeInTheDocument();

    unmount();

    mockDecksAndTags(false);
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    renderScreen();

    const enabledBtn = await screen.findByRole("button", { name: /Move to trash \(1\)/i });
    await waitFor(() => expect(enabledBtn).toBeEnabled());
    expect(
      screen.queryByText(
        "Media from the old app folder is still being copied. Cleanup is available when it finishes.",
      ),
    ).not.toBeInTheDocument();
  });

  it("unused_media_button_disabled", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();
    vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    renderScreen();

    const unusedTile = await screen.findByRole("button", {
      name: /Preview lecture-clip\.mp4/i,
    });
    await user.click(unusedTile);

    const preview = await screen.findByRole("region", { name: /Media preview/i });
    const showNotesBtn = screen.getByRole("button", { name: /Show notes using it/i });
    expect(showNotesBtn).toBeDisabled();
    expect(showNotesBtn).toHaveAttribute("title", "Not used in any note");
    expect(preview).toHaveTextContent("Not used in any note");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("BW2-8: shows Used/Unused segmented filter with counts, plain-words unused explanation, and Move to trash bulk action", async () => {
    const user = userEvent.setup();
    mockDecksAndTags();
    const listSpy = vi.spyOn(ipcModule.ipc, "listMediaLibrary").mockResolvedValue(samplePage);
    vi.spyOn(ipcModule.ipc, "deleteUnusedMedia").mockResolvedValue(1);
    renderScreen();

    await screen.findByAltText("heart-diagram.png");

    // Segmented usage filter with counts (All 3, Used 2, Unused 1)
    const usageGroup = screen.getByRole("group", { name: /Usage/i });
    expect(within(usageGroup).getByRole("button", { name: /All \(3\)/i })).toBeInTheDocument();
    expect(within(usageGroup).getByRole("button", { name: /Used \(2\)/i })).toBeInTheDocument();
    const unusedTab = within(usageGroup).getByRole("button", { name: /Unused \(1\)/i });
    expect(unusedTab).toHaveAttribute(
      "title",
      expect.stringMatching(/in your media folder, not used by any card or template/i),
    );

    // Move to trash bulk action
    const trashBtn = screen.getByRole("button", { name: /Move to trash \(1\)/i });
    expect(trashBtn).toBeEnabled();

    // Switching to Unused segmented filter calls listMediaLibrary with usage: "unused"
    listSpy.mockResolvedValueOnce({
      items: [],
      total_count: 0,
      library_count: 3,
      unused_count: 0,
      total_bytes: samplePage.total_bytes,
    });
    await user.click(unusedTab);
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(
        "",
        MEDIA_PAGE_SIZE,
        0,
        expect.objectContaining({ usage: "unused" }),
      );
    });
    expect(
      await screen.findByText(/in your media folder, not used by any card or template/i),
    ).toBeInTheDocument();
  });
});
