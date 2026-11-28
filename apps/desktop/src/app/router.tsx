/* eslint-disable react-refresh/only-export-components */
import { lazy } from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/app/AppShell";
import { RouteError } from "@/components/RouteError";

const DeckBrowserScreen = lazy(() =>
  import("@/features/decks/DeckBrowserScreen").then((m) => ({ default: m.DeckBrowserScreen })),
);
const StudySessionScreen = lazy(() =>
  import("@/features/study/StudySessionScreen").then((m) => ({ default: m.StudySessionScreen })),
);

const AddScreen = lazy(() =>
  import("@/features/add/AddScreen").then((m) => ({ default: m.AddScreen })),
);
const BrowseScreen = lazy(() =>
  import("@/features/browse/BrowseScreen").then((m) => ({ default: m.BrowseScreen })),
);
const StatsScreen = lazy(() =>
  import("@/features/stats/StatsScreen").then((m) => ({ default: m.StatsScreen })),
);
const SettingsScreen = lazy(() =>
  import("@/features/settings/SettingsScreen").then((m) => ({ default: m.SettingsScreen })),
);
const NotetypeScreen = lazy(() =>
  import("@/features/notetypes/NotetypeScreen").then((m) => ({ default: m.NotetypeScreen })),
);
const MediaLibraryScreen = lazy(() =>
  import("@/features/media/MediaLibraryScreen").then((m) => ({ default: m.MediaLibraryScreen })),
);
const QuickAddScreen = lazy(() =>
  import("@/features/add/QuickAddScreen").then((m) => ({ default: m.QuickAddScreen })),
);
const AssistantScreen = lazy(() =>
  import("@/features/ai/AssistantScreen").then((m) => ({ default: m.AssistantScreen })),
);
const GenerateCardsScreen = lazy(() =>
  import("@/features/ai/GenerateCardsScreen").then((m) => ({ default: m.GenerateCardsScreen })),
);
const QualityReviewRoute = lazy(() =>
  import("@/features/ai/QualityReviewScreen").then((m) => ({ default: m.QualityReviewRoute })),
);
const TranscriptScreen = lazy(() =>
  import("@/features/ai/TranscriptScreen").then((m) => ({ default: m.TranscriptScreen })),
);
const CharacterScreen = lazy(() =>
  import("@/features/character/CharacterScreen").then((m) => ({ default: m.CharacterScreen })),
);
const ShopScreen = lazy(() =>
  import("@/routes/ShopScreen").then((m) => ({ default: m.ShopScreen })),
);
const StreakScreen = lazy(() =>
  import("@/features/motivation/StreakScreen").then((m) => ({ default: m.StreakScreen })),
);
const QuestsScreen = lazy(() =>
  import("@/features/quests/QuestsScreen").then((m) => ({ default: m.QuestsScreen })),
);
const ActivityScreen = lazy(() =>
  import("@/features/activity/ActivityScreen").then((m) => ({ default: m.ActivityScreen })),
);
const EisenhowerMatrixScreen = lazy(() =>
  import("@/features/matrix/EisenhowerMatrixScreen").then((m) => ({
    default: m.EisenhowerMatrixScreen,
  })),
);
const HabitTrackerScreen = lazy(() =>
  import("@/features/habits/HabitTrackerScreen").then((m) => ({
    default: m.HabitTrackerScreen,
  })),
);
const CalendarScreen = lazy(() =>
  import("@/features/calendar/CalendarScreen").then((m) => ({
    default: m.CalendarScreen,
  })),
);

const rootRoute = createRootRoute({ component: AppShell });

const errorComponent = ({ error }: { error: unknown }) => <RouteError error={error} />;

export interface DecksSearch {
  create?: boolean;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DeckBrowserScreen,
  errorComponent,
  validateSearch: (search: Record<string, unknown>): DecksSearch => ({
    create: search.create === true ? true : undefined,
  }),
});
const studySessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/study/$deckId",
  component: StudySessionScreen,
  errorComponent,
  params: {
    parse: (raw: Record<string, string>) => {
      const deckId = Number(raw.deckId);
      if (!Number.isFinite(deckId)) throw new Error(`invalid deck id "${raw.deckId}"`);
      return { deckId };
    },
    stringify: (params: { deckId: number }) => ({ deckId: String(params.deckId) }),
  },
});
const studyRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/study",
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
export interface StatsSearch {
  deck?: number;
  range?: "7d" | "1m" | "3m" | "1y" | "all";
}

export interface BrowseSearch {
  q?: string;
  from?: "stats";
  backDeck?: number;
  backRange?: StatsSearch["range"];
}

const STATS_RANGES = ["7d", "1m", "3m", "1y", "all"] as const;

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browse",
  component: BrowseScreen,
  errorComponent,
  validateSearch: (search: Record<string, unknown>): BrowseSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    from: search.from === "stats" ? "stats" : undefined,
    backDeck: typeof search.backDeck === "number" ? search.backDeck : undefined,
    backRange: STATS_RANGES.includes(search.backRange as never)
      ? (search.backRange as StatsSearch["range"])
      : undefined,
  }),
});

const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: StatsScreen,
  errorComponent,
  validateSearch: (search: Record<string, unknown>): StatsSearch => ({
    deck: typeof search.deck === "number" ? search.deck : undefined,
    range: STATS_RANGES.includes(search.range as never)
      ? (search.range as StatsSearch["range"])
      : undefined,
  }),
});
export interface AddSearch {
  deckId?: number;
}

const addRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/add",
  component: AddScreen,
  errorComponent,
  validateSearch: (search: Record<string, unknown>): AddSearch => ({
    deckId: typeof search.deckId === "number" ? search.deckId : undefined,
  }),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsScreen,
  errorComponent,
});
const notetypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notetypes",
  component: NotetypeScreen,
  errorComponent,
});
const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media",
  component: MediaLibraryScreen,
  errorComponent,
});
const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assistant",
  component: AssistantScreen,
  errorComponent,
});
const generateCardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assistant/generate",
  component: GenerateCardsScreen,
  errorComponent,
});

export interface QualityReviewSearch {
  deckId?: number;
  noteIds?: string;
}

const qualityReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assistant/quality",
  component: QualityReviewRoute,
  errorComponent,
  validateSearch: (search: Record<string, unknown>): QualityReviewSearch => ({
    deckId:
      typeof search.deckId === "number"
        ? search.deckId
        : typeof search.deckId === "string" && /^\d+$/.test(search.deckId)
          ? Number(search.deckId)
          : undefined,
    noteIds:
      typeof search.noteIds === "string" && search.noteIds.trim().length > 0
        ? search.noteIds
        : undefined,
  }),
});
const quickAddRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/quick-add",
  component: QuickAddScreen,
  errorComponent,
});
const transcriptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transcript",
  component: TranscriptScreen,
  errorComponent,
});
const matrixRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plan/matrix",
  component: EisenhowerMatrixScreen,
  errorComponent,
});
const habitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plan/habits",
  component: HabitTrackerScreen,
  errorComponent,
});
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plan/calendar",
  component: CalendarScreen,
  errorComponent,
});
const characterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/character",
  component: CharacterScreen,
  errorComponent,
});
const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shop",
  component: ShopScreen,
  errorComponent,
});
const streakRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/streak",
  component: StreakScreen,
  errorComponent,
});
const questsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/quests",
  component: QuestsScreen,
  errorComponent,
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityScreen,
  errorComponent,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  studySessionRoute,
  studyRedirectRoute,
  browseRoute,
  addRoute,
  quickAddRoute,
  statsRoute,
  transcriptRoute,
  matrixRoute,
  habitsRoute,
  calendarRoute,
  characterRoute,
  shopRoute,
  streakRoute,
  questsRoute,
  activityRoute,
  assistantRoute,
  generateCardsRoute,
  qualityReviewRoute,
  settingsRoute,
  notetypesRoute,
  mediaRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
