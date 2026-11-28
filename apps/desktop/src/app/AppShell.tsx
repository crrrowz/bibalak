import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { QueryClientContext } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  BookType,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Moon,
  PlusCircle,
  Puzzle,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Sun,
  Target,
  User,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { StyleDefaultIcon, StyleGameIcon, StyleScholarIcon } from "@/components/icons/progress";
import { StylePopover } from "@/components/quick/StylePopover";
import { VolumePopover } from "@/components/quick/VolumePopover";
import { UnlockToastHost } from "@/features/game/depth/UnlockToastHost";
import { OnboardingGate } from "@/features/onboarding/OnboardingGate";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { NotificationEventWatcher } from "@/features/notifications/NotificationEventWatcher";
import { NotificationToastHost } from "@/features/notifications/NotificationToastHost";
import { CelebrationHost } from "@/features/progress/CelebrationHost";
import { UpdateCheckHost } from "@/features/settings/UpdateCheckHost";
import { StyleHud } from "@/features/progress/StyleHud";
import { Kbd } from "@/components/Kbd";
import { matchesKey, matchesQuestionMark, modShortcut } from "@/lib/shortcuts";
import { useCoreEvents } from "@/lib/useCoreEvents";
import { ipc, isTauri } from "@/lib/ipc";
import { invalidateTodayCounts } from "@/lib/queryRefresh";
import { queryKeys } from "@/lib/queryKeys";
import { formatUndoAction } from "@/lib/undo";
import { useUndoShortcut } from "@/lib/undoToast";
import { toast } from "@/stores/toast";
import { platform } from "@/lib/platform";
import { ReminderSchedulerHost } from "@/lib/reminders/ReminderSchedulerHost";
import { panelKey, pluginHost } from "@/lib/pluginHost";
import { PluginBootHost } from "@/features/plugins/PluginBootHost";
import { PluginPanelDrawer } from "@/features/plugins/PluginPanelDrawer";
import { useUi } from "@/stores/ui";
import { useTheme } from "@/stores/theme";
import { useSound } from "@/stores/sound";
import { useStyle } from "@/stores/style";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/toast";
import { ease } from "@/lib/motion";
import { t, useLocale } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";

const CMDK_TIP_KEY = "keepsake-tip-cmdk";

/**
 * Single app-wide z-index layer table (lowest to highest).
 * Pop-up notifications sit below headers, menus, popovers, panels, and dialogs.
 *
 *  0   base     — page content & background vignette
 * 10   sticky   — sticky table headers, timegrid events, study card column
 * 20   header   — sticky ScreenHeader, StyleHud, ActionMenu
 * 25   popup    — NotificationToastHost (portaled, below title bar & HUD, above screen headers)
 * 30   popover  — inline popovers, XpFloatBadge, Toaster (bottom-end error/confirm), SidePanel backdrop, top-bar bell slot
 * 40   panel    — SidePanel mobile drawer, CommandPaletteTip, hover-sidebar trigger
 * 50   modal    — Dialog, CommandPalette, KeyboardShortcutsDialog, NotificationPanel, volume-popover, style-popover, hover-sidebar
 * 100  skip     — skip-to-content accessibility link
 */

function CommandPaletteTip() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(CMDK_TIP_KEY) === "1");
  const paletteOpenSignal = useUi((s) => s.paletteOpenSignal);
  const sidePanelCount = useUi((s) => s.sidePanelCount);

  useEffect(() => {
    if (paletteOpenSignal > 0) {
      localStorage.setItem(CMDK_TIP_KEY, "1");
      setDismissed(true);
    }
  }, [paletteOpenSignal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesKey(e, "KeyK", "k") && (e.metaKey || e.ctrlKey)) {
        localStorage.setItem(CMDK_TIP_KEY, "1");
        setDismissed(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (dismissed || sidePanelCount > 0) return null;

  return (
    <div
      data-testid="command-palette-tip"
      className="flex items-center justify-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
    >
      <span>{t("shell.tip.press")}</span>
      <Kbd>{modShortcut("K")}</Kbd>
      <span>{t("shell.tip.jump")}</span>
      <button
        type="button"
        aria-label={t("shell.tip.dismiss")}
        onClick={() => {
          localStorage.setItem(CMDK_TIP_KEY, "1");
          setDismissed(true);
        }}
        className="ms-1 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

const nav: {
  to: string;
  label: LocaleKey;
  icon: React.ElementType;
  exact: boolean;
  alsoMatch?: string;
}[] = [
  { to: "/", label: "nav.decks", icon: Layers, exact: true, alsoMatch: "/study/$deckId" },
  { to: "/browse", label: "nav.browse", icon: Search, exact: false },
  { to: "/add", label: "nav.add", icon: PlusCircle, exact: false },
  { to: "/notetypes", label: "nav.notetypes", icon: BookType, exact: false },
  { to: "/media", label: "nav.media", icon: ImageIcon, exact: false },
  { to: "/stats", label: "nav.stats", icon: BarChart3, exact: false },
  { to: "/assistant", label: "nav.assistant", icon: Sparkles, exact: false },
  { to: "/activity", label: "nav.activity", icon: History, exact: false },
];

const planNav: {
  to: string;
  label: LocaleKey;
  icon: React.ElementType;
  exact: boolean;
}[] = [
  { to: "/plan/matrix", label: "nav.matrix", icon: LayoutGrid, exact: false },
  { to: "/plan/habits", label: "nav.habits", icon: CheckCircle2, exact: false },
  { to: "/plan/calendar", label: "nav.calendar", icon: CalendarIcon, exact: false },
];

type SidebarMode = "docked" | "hover";

const ICON_ONLY_THRESHOLD = 96;
const FOOTER_STACK_THRESHOLD = 204;
const MIN_WIDTH = 44;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 240;
const MOBILE_BREAKPOINT_PX = 768;

function readIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth > 0 && window.innerWidth < MOBILE_BREAKPOINT_PX) return true;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches;
  }
  return false;
}

function readMode(): SidebarMode {
  return (localStorage.getItem("sb-mode") as SidebarMode) ?? "docked";
}
function readWidth(): number {
  return Number(localStorage.getItem("sb-width")) || DEFAULT_WIDTH;
}

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
  compact,
  alsoMatch,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  exact: boolean;
  compact: boolean;
  alsoMatch?: string;
}) {
  const matchRoute = useMatchRoute();
  const isActive =
    !!matchRoute({ to, fuzzy: !exact }) ||
    (!!alsoMatch && !!matchRoute({ to: alsoMatch, fuzzy: true }));

  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      title={compact ? label : undefined}
      className={`relative flex items-center rounded-md py-2 text-sm font-medium transition-colors ${compact ? "justify-center px-2" : "gap-2.5 px-3"}`}
      activeProps={{ className: "text-foreground" }}
      inactiveProps={{
        className: "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      }}
    >
      {isActive && (
        <motion.div
          layoutId="nav-pill"
          className="absolute inset-0 rounded-md bg-sidebar-accent"
          transition={{ duration: 0.18, ease }}
        />
      )}
      <span className={`relative z-10 flex min-w-0 items-center ${compact ? "" : "gap-2.5"}`}>
        <Icon className="size-4 shrink-0" />
        {!compact && <span className="truncate">{label}</span>}
      </span>
    </Link>
  );
}

function SidebarContent({
  compact,
  stackedFooter,
  mode,
  toggleMode,
}: {
  compact: boolean;
  stackedFooter: boolean;
  mode: SidebarMode;
  toggleMode: () => void;
}) {
  const matchRoute = useMatchRoute();
  const settingsActive = !!matchRoute({ to: "/settings", fuzzy: true });
  const style = useStyle((s) => s.style);
  const pluginSnapshot = useSyncExternalStore(pluginHost.subscribe, pluginHost.getSnapshot);
  const questsLabel = t(
    style === "game"
      ? "motivation.quests.title.game"
      : style === "scholar"
        ? "motivation.quests.title.scholar"
        : "motivation.quests.title.default",
  );
  const styleNav =
    style === "game"
      ? [
          { to: "/character", label: "nav.character" as const, icon: User, exact: false },
          { to: "/shop", label: "nav.shop" as const, icon: ShoppingBag, exact: false },
        ]
      : style === "scholar"
        ? [{ to: "/character", label: "nav.character" as const, icon: User, exact: false }]
        : [];

  return (
    <>
      {/* Wordmark + collapse toggle (logo itself already shown in TitleBar) */}
      <div
        className={`flex h-12 shrink-0 items-center border-b border-border/60 ${compact ? "justify-center px-2" : "justify-between px-4"}`}
      >
        {!compact && (
          <span className="text-[13px] font-semibold tracking-tight text-muted-foreground">
            Bibalak
          </span>
        )}
        {!compact && (
          <button
            onClick={toggleMode}
            title={mode === "docked" ? t("titlebar.hoverModeHint") : t("titlebar.dockSidebarHint")}
            className="rounded p-1 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            {mode === "docked" ? (
              <ChevronLeft className="size-4 rtl:-scale-x-100" />
            ) : (
              <ChevronRight className="size-4 rtl:-scale-x-100" />
            )}
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav
        aria-label={t("nav.main")}
        className={`flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto py-2 ${compact ? "px-1" : "px-2"}`}
      >
        {nav.map(({ to, label, icon, exact, alsoMatch }) => (
          <NavLink
            key={to}
            to={to}
            label={t(label)}
            icon={icon}
            exact={exact}
            compact={compact}
            alsoMatch={alsoMatch}
          />
        ))}
        <NavLink to="/quests" label={questsLabel} icon={Target} exact={false} compact={compact} />
        <div role="group" aria-label={t("nav.plan")} className="pt-3">
          {!compact && (
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("nav.plan")}
            </p>
          )}
          <div className="space-y-0.5">
            {planNav.map(({ to, label, icon, exact }) => (
              <NavLink
                key={to}
                to={to}
                label={t(label)}
                icon={icon}
                exact={exact}
                compact={compact}
              />
            ))}
          </div>
        </div>
        {styleNav.length > 0 && (
          <div
            role="group"
            aria-label={style === "game" ? t("nav.game") : t("nav.scholar")}
            className="pt-3"
          >
            {!compact && (
              <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {style === "game" ? t("nav.game") : t("nav.scholar")}
              </p>
            )}
            <div className="space-y-0.5">
              {styleNav.map(({ to, label, icon, exact }) => (
                <NavLink
                  key={to}
                  to={to}
                  label={t(label)}
                  icon={icon}
                  exact={exact}
                  compact={compact}
                />
              ))}
            </div>
          </div>
        )}
        {pluginSnapshot.panels.length > 0 && (
          <div role="group" aria-label={t("nav.plugins")} className="pt-3">
            {!compact && (
              <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("nav.plugins")}
              </p>
            )}
            <div className="space-y-0.5">
              {pluginSnapshot.panels.map((p) => {
                const key = panelKey(p.pluginId, p.id);
                const isOpen = pluginSnapshot.activePanelKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={p.title}
                    aria-pressed={isOpen}
                    title={compact ? p.title : undefined}
                    onClick={() =>
                      isOpen ? pluginHost.closePanel() : pluginHost.openPanel(p.pluginId, p.id)
                    }
                    className={`relative flex w-full items-center rounded-md py-2 text-sm font-medium transition-colors ${
                      compact ? "justify-center px-2" : "gap-2.5 px-3"
                    } ${
                      isOpen
                        ? "bg-sidebar-accent text-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    }`}
                  >
                    <Puzzle className="size-4 shrink-0" />
                    {!compact && <span className="truncate">{p.title}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom: Settings + quick toggles */}
      <SidebarFooter compact={compact} stacked={stackedFooter} settingsActive={settingsActive} />
    </>
  );
}

function SidebarFooter({
  compact,
  stacked,
  settingsActive,
}: {
  compact: boolean;
  stacked: boolean;
  settingsActive: boolean;
}) {
  const { locale, setLocale } = useLocale();
  const { resolved, setTheme } = useTheme();
  const style = useStyle((s) => s.style);
  const cardVolume = useSound((s) => s.cardVolume);
  const cardMuted = useSound((s) => s.cardMuted);
  const appVolume = useSound((s) => s.appVolume);
  const appMuted = useSound((s) => s.appMuted);
  const [soundOpen, setSoundOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const soundBtnRef = useRef<HTMLButtonElement>(null);
  const styleBtnRef = useRef<HTMLButtonElement>(null);

  const toggleTheme = () => {
    setTheme(resolved === "dark" ? "light" : "dark");
  };

  const toggleLanguage = () => {
    setLocale(locale === "en" ? "ar" : "en");
  };

  const bothMuted = cardMuted && appMuted;
  const maxActiveVolume = Math.max(cardMuted ? 0 : cardVolume, appMuted ? 0 : appVolume);
  const soundIcon = bothMuted ? (
    <VolumeX className="size-4 shrink-0" />
  ) : maxActiveVolume < 50 ? (
    <Volume1 className="size-4 shrink-0" />
  ) : (
    <Volume2 className="size-4 shrink-0" />
  );

  const themeIcon =
    resolved === "dark" ? (
      <Sun className="size-4 shrink-0" />
    ) : (
      <Moon className="size-4 shrink-0" />
    );

  const styleIcon =
    style === "game" ? (
      <StyleGameIcon className="size-4 shrink-0" />
    ) : style === "scholar" ? (
      <StyleScholarIcon className="size-4 shrink-0" />
    ) : (
      <StyleDefaultIcon className="size-4 shrink-0" />
    );

  const itemBaseClass =
    "relative flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      data-testid="sidebar-footer"
      className={`mt-auto border-t border-border py-2 ${compact ? "px-1" : "px-2"} ${
        stacked
          ? "flex flex-col items-center gap-1"
          : "flex flex-row items-center justify-between gap-1"
      }`}
    >
      {/* Settings */}
      <Link
        to="/settings"
        activeOptions={{ exact: false }}
        aria-label={t("nav.settings")}
        aria-current={settingsActive ? "page" : undefined}
        title={t("nav.settings")}
        className={`${itemBaseClass} ${stacked ? "w-full" : "flex-1"} ${settingsActive ? "text-foreground" : ""}`}
        activeProps={{ className: "text-foreground" }}
      >
        {settingsActive && (
          <motion.div
            layoutId="nav-pill"
            className="absolute inset-0 rounded-md bg-sidebar-accent"
            transition={{ duration: 0.18, ease }}
          />
        )}
        <span className="relative z-10 flex items-center justify-center">
          <Settings className="size-4 shrink-0" />
        </span>
      </Link>

      {/* Language */}
      <button
        type="button"
        onClick={toggleLanguage}
        aria-label={t("nav.switchLanguage")}
        title={t("nav.switchLanguage")}
        className={`${itemBaseClass} ${stacked ? "w-full" : "flex-1"} text-xs font-semibold`}
      >
        <span>{locale.toUpperCase()}</span>
      </button>

      {/* Theme */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={t("nav.switchTheme")}
        title={t("nav.switchTheme")}
        className={`${itemBaseClass} ${stacked ? "w-full" : "flex-1"}`}
      >
        {themeIcon}
      </button>

      {/* Style */}
      <div className={`relative ${stacked ? "w-full" : "flex-1"} flex justify-center`}>
        <button
          ref={styleBtnRef}
          type="button"
          onClick={() => {
            setSoundOpen(false);
            setStyleOpen((o) => !o);
          }}
          aria-label={t("settings.style.label")}
          title={t("settings.style.label")}
          aria-expanded={styleOpen}
          className={`${itemBaseClass} w-full`}
        >
          {styleIcon}
        </button>

        <StylePopover
          open={styleOpen}
          compact={stacked}
          anchorRef={styleBtnRef}
          onClose={() => setStyleOpen(false)}
        />
      </div>

      {/* Sound */}
      <div className={`relative ${stacked ? "w-full" : "flex-1"} flex justify-center`}>
        <button
          ref={soundBtnRef}
          type="button"
          onClick={() => {
            setStyleOpen(false);
            setSoundOpen((o) => !o);
          }}
          aria-label={t("nav.sound")}
          title={t("nav.sound")}
          aria-expanded={soundOpen}
          data-muted={bothMuted ? "true" : "false"}
          className={`${itemBaseClass} w-full`}
        >
          {soundIcon}
        </button>

        <VolumePopover
          open={soundOpen}
          compact={stacked}
          anchorRef={soundBtnRef}
          onClose={() => setSoundOpen(false)}
        />
      </div>
    </div>
  );
}

export function AppShell() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mode, setMode] = useState<SidebarMode>(readMode);
  const [sidebarWidth, setSidebarWidth] = useState(readWidth);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(readIsMobile);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const matchRoute = useMatchRoute();
  const isStudy = !!matchRoute({ to: "/study/$deckId", fuzzy: true });
  const focusMode = useUi((s) => s.focusMode);
  const setFocusMode = useUi((s) => s.setFocusMode);
  const openPalette = useUi((s) => s.openPalette);
  const inFocus = focusMode && isStudy;
  const isQuickAddWindow = platform.window?.label?.() === "quick-add";
  const queryClient = useContext(QueryClientContext);
  useCoreEvents();

  const handleGlobalUndo = useCallback(() => {
    void ipc
      .undo()
      .then((undone) => {
        if (undone) {
          toast.info(t("study.toast.undone", { action: formatUndoAction(undone) }));
          if (queryClient) {
            void invalidateTodayCounts(queryClient);
            void queryClient.invalidateQueries({ queryKey: queryKeys.habitsAll });
            void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
          }
        }
      })
      .catch(() => {});
  }, [queryClient]);

  useUndoShortcut(handleGlobalUndo, isTauri() && !isQuickAddWindow && !isStudy);

  // Register the saved quick-add global shortcut in the main window when enabled.
  useEffect(() => {
    if (isQuickAddWindow || !isTauri() || !platform.globalShortcut) return;
    let mounted = true;
    let active: string | null = null;
    void ipc
      .getQuickAddConfig()
      .then(async (cfg) => {
        if (!mounted || !cfg.enabled || !platform.globalShortcut) return;
        const already = await platform.globalShortcut.isRegistered(cfg.shortcut).catch(() => false);
        if (!already) {
          await platform.globalShortcut.register(cfg.shortcut, () => {
            void ipc.toggleQuickAdd();
          });
        }
        active = cfg.shortcut;
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (active && platform.globalShortcut) {
        void platform.globalShortcut.unregister(active).catch(() => {});
      }
    };
  }, [isQuickAddWindow]);

  // Never leave focus mode "on" once the user navigates away from study.
  useEffect(() => {
    if (!isStudy && focusMode) setFocusMode(false);
  }, [isStudy, focusMode, setFocusMode]);

  useEffect(() => {
    localStorage.setItem("sb-mode", mode);
    if (mode === "hover") setHoverOpen(false);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("sb-width", String(sidebarWidth));
  }, [sidebarWidth]);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "docked" ? "hover" : "docked"));
  }, []);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        // The sidebar sits on the inline-start side: in RTL, dragging left widens it.
        const delta = ev.clientX - startX;
        const next = startWidth + (document.documentElement.dir === "rtl" ? -delta : delta);
        if (next < MIN_WIDTH) {
          setMode("hover");
          setIsResizing(false);
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          return;
        }
        setSidebarWidth(Math.min(next, MAX_WIDTH));
      };

      const onUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  useEffect(() => {
    const syncMobile = () => {
      const mobile = readIsMobile();
      setIsMobile(mobile);
      if (!mobile) setMobileDrawerOpen(false);
    };
    syncMobile();
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)
        : null;
    mq?.addEventListener("change", syncMobile);
    window.addEventListener("resize", syncMobile);
    return () => {
      mq?.removeEventListener("change", syncMobile);
      window.removeEventListener("resize", syncMobile);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileDrawerOpen) {
        e.preventDefault();
        setMobileDrawerOpen(false);
        return;
      }
      if (e.altKey && matchesKey(e, "KeyZ", "z")) {
        e.preventDefault();
        if (isMobile) {
          setMobileDrawerOpen((o) => !o);
        } else {
          toggleMode();
        }
        return;
      }
      if (
        matchesQuestionMark(e) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleMode, isMobile, mobileDrawerOpen]);

  const iconOnly = mode === "docked" && sidebarWidth < ICON_ONLY_THRESHOLD;
  const stackedFooter = iconOnly || (mode === "docked" && sidebarWidth < FOOTER_STACK_THRESHOLD);

  if (isQuickAddWindow) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <Suspense
          fallback={
            <div
              role="status"
              className="flex h-full items-center justify-center text-sm text-muted-foreground"
            >
              {t("common.loading")}
            </div>
          }
        >
          <Outlet />
        </Suspense>
        <Toaster />
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen flex-col overflow-hidden bg-background text-foreground ${isResizing ? "select-none cursor-col-resize" : ""}`}
    >
      <div className="relative shrink-0">
        <TitleBar
          onToggleSidebar={isMobile ? () => setMobileDrawerOpen((o) => !o) : toggleMode}
          showSidebarDock={(isMobile || mode === "hover") && !inFocus}
          onOpenPalette={openPalette}
          trailing={<NotificationBell />}
        />
        {!inFocus && <CommandPaletteTip />}
      </div>

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t("shell.skipToContent")}
      </a>

      <div className="relative flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {!inFocus &&
            (isMobile ? (
              mobileDrawerOpen && (
                <>
                  <div
                    key="mobile-sidebar-backdrop"
                    data-testid="mobile-sidebar-backdrop"
                    aria-hidden="true"
                    className="fixed inset-0 z-40 bg-background/60 backdrop-blur-xs"
                    onClick={() => setMobileDrawerOpen(false)}
                  />
                  <motion.aside
                    key="mobile-sidebar-drawer"
                    data-testid="mobile-sidebar-drawer"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t("nav.main")}
                    initial={{
                      x: document.documentElement.dir === "rtl" ? "100%" : "-100%",
                      opacity: 0,
                    }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{
                      x: document.documentElement.dir === "rtl" ? "100%" : "-100%",
                      opacity: 0,
                    }}
                    transition={{ duration: 0.2, ease }}
                    className="glass-chrome fixed inset-y-0 start-0 z-50 flex w-64 max-w-[85vw] flex-col border-e shadow-xl"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a")) {
                        setMobileDrawerOpen(false);
                      }
                    }}
                  >
                    <SidebarContent
                      compact={false}
                      stackedFooter={false}
                      mode="docked"
                      toggleMode={() => setMobileDrawerOpen(false)}
                    />
                  </motion.aside>
                </>
              )
            ) : mode === "docked" ? (
              <motion.aside
                key="docked-sidebar"
                style={{ width: sidebarWidth }}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: sidebarWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: isResizing ? 0 : 0.15, ease }}
                className="glass-chrome relative flex shrink-0 flex-col border-e"
              >
                <SidebarContent
                  compact={iconOnly}
                  stackedFooter={stackedFooter}
                  mode={mode}
                  toggleMode={toggleMode}
                />
                {/* Drag handle (pointer + keyboard accessible) */}
                <div
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={t("shell.resizeSidebar")}
                  aria-valuemin={MIN_WIDTH}
                  aria-valuemax={MAX_WIDTH}
                  aria-valuenow={sidebarWidth}
                  onMouseDown={handleDragStart}
                  onKeyDown={(e) => {
                    const rtl = document.documentElement.dir === "rtl";
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      setSidebarWidth((w) =>
                        Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + (rtl ? -16 : 16))),
                      );
                    } else if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      setSidebarWidth((w) =>
                        Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + (rtl ? 16 : -16))),
                      );
                    }
                  }}
                  className="absolute end-0 top-0 h-full w-1.5 cursor-col-resize transition-colors hover:bg-primary/30 focus-visible:bg-primary/50 focus-visible:outline-none active:bg-primary/50"
                />
              </motion.aside>
            ) : (
              /* Hover mode: trigger strip + animated overlay */
              <motion.div key="hover-trigger" exit={{ opacity: 0 }}>
                <div
                  className="absolute start-0 top-0 z-40 h-full w-3"
                  onMouseEnter={() => setHoverOpen(true)}
                />
                <AnimatePresence>
                  {hoverOpen && (
                    <motion.aside
                      key="hover-sidebar"
                      initial={{
                        x: document.documentElement.dir === "rtl" ? "100%" : "-100%",
                        opacity: 0,
                      }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{
                        x: document.documentElement.dir === "rtl" ? "100%" : "-100%",
                        opacity: 0,
                      }}
                      transition={{ duration: 0.2, ease }}
                      className="glass-chrome absolute start-0 top-0 z-50 flex h-full flex-col border-e shadow-xl"
                      style={{ width: Math.max(sidebarWidth, DEFAULT_WIDTH) }}
                      onMouseLeave={() => setHoverOpen(false)}
                    >
                      <SidebarContent
                        compact={false}
                        stackedFooter={false}
                        mode={mode}
                        toggleMode={toggleMode}
                      />
                    </motion.aside>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          {isTauri() && <StyleHud inFocus={inFocus} />}
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <main
              id="main-content"
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-auto outline-none"
            >
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease }}
                className="h-full"
              >
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="flex h-full min-h-[12rem] items-center justify-center text-sm text-muted-foreground"
                    >
                      {t("common.loading")}
                    </div>
                  }
                >
                  <Outlet />
                </Suspense>
              </motion.div>
            </main>
            <NotificationToastHost />
          </div>
        </div>
        <PluginPanelDrawer />
      </div>

      <CommandPalette />
      <PluginBootHost />
      <OnboardingGate />
      {isTauri() && <NotificationEventWatcher />}
      {isTauri() && platform.notifications && <ReminderSchedulerHost />}
      {isTauri() && !isQuickAddWindow && <UpdateCheckHost />}
      {isTauri() && <CelebrationHost />}
      {isTauri() && <UnlockToastHost />}
      {shortcutsOpen && <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      <Toaster />
    </div>
  );
}
