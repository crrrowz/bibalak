import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { QueryClientContext } from "@tanstack/react-query";
import type { AvatarProfileDto, EquippedSlotDto } from "@bibalak/ipc-types";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { PetLayer } from "@/components/avatar/layers/game/pets";
import { useGameDepthState } from "@/features/game/depth/useGameDepth";
import { useGameState } from "@/features/game/useGameState";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { t } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { dur, ease, useReducedMotion } from "@/lib/motion";
import { getStyleSkin } from "@/lib/styles/skins";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { useStyle } from "@/stores/style";
import { NotificationKindIcon } from "./notificationHelpers";
import { navigateToNotificationLink } from "./notificationLink";
import { useNotificationStore, type PopupNotification } from "./notificationStore";

const MAX_VISIBLE_POPUPS = 3;
const MIN_POPUP_TOP_PX = 48; // 36px TitleBar (h-9) + 12px gap
const TOP_TOOLBAR_SELECTOR = "[data-toast-anchor]";
const AVOID_CTA_SELECTOR = "[data-toast-avoid]";

function computePopupTopOffset(): number {
  if (typeof document === "undefined") return MIN_POPUP_TOP_PX;
  const main = document.getElementById("main-content");
  if (!main) return MIN_POPUP_TOP_PX;
  const mainTop = main.getBoundingClientRect().top;
  let anchorBottom = mainTop > 0 ? mainTop : 0;

  for (const bar of main.querySelectorAll(TOP_TOOLBAR_SELECTOR)) {
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0 && rect.width > 0 && rect.top <= anchorBottom + 24) {
      anchorBottom = Math.max(anchorBottom, rect.bottom);
    }
  }

  const vw = window.innerWidth || 1200;
  const isRtl = document.documentElement.dir === "rtl";
  const popupZoneStart = isRtl ? 16 : vw - 376;
  const popupZoneEnd = isRtl ? 376 : vw - 16;
  for (const cta of document.querySelectorAll(AVOID_CTA_SELECTOR)) {
    const rect = cta.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    const intersectsX = rect.left < popupZoneEnd && rect.right > popupZoneStart;
    if (intersectsX && rect.top < anchorBottom + 260) {
      anchorBottom = Math.max(anchorBottom, rect.bottom);
    }
  }

  if (anchorBottom <= 0) return MIN_POPUP_TOP_PX;
  return Math.max(MIN_POPUP_TOP_PX, Math.round(anchorBottom) + 12);
}

function hasBlockingLayer(panelOpen: boolean, topOffset: number): boolean {
  if (panelOpen) return true;
  if (typeof document === "undefined") return false;

  if (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [data-testid="volume-popover"], [data-testid="style-popover"]',
    )
  ) {
    return true;
  }

  // Never cover the active study card when its geometry intersects the top inline-end pop-up zone.
  const studyCard = document.querySelector(".keepsake-card");
  if (studyCard) {
    const rect = studyCard.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const vw = window.innerWidth || 1200;
      const isRtl = document.documentElement.dir === "rtl";
      const popupZoneStart = isRtl ? 16 : vw - 376;
      const popupZoneEnd = isRtl ? 376 : vw - 16;
      const intersectsX = rect.left < popupZoneEnd && rect.right > popupZoneStart;
      const intersectsY = rect.top < topOffset + 240 && rect.bottom > topOffset;
      if (intersectsX && intersectsY) {
        return true;
      }
    }
  }

  return false;
}

function PopupCardContent({
  popup,
  initialRemainingMs,
  onSaveRemaining,
  reduced,
  skinId,
  level,
  profile,
  equipped,
  activePet,
  mounted,
  onDismiss,
}: {
  popup: PopupNotification;
  initialRemainingMs: number;
  onSaveRemaining: (id: string, remainingMs: number) => void;
  reduced: boolean;
  skinId: "game" | "scholar" | null;
  level: number;
  profile: AvatarProfileDto | null;
  equipped: EquippedSlotDto[] | null;
  activePet: { speciesKey: string; variantKey: string } | null;
  mounted: boolean;
  onDismiss: (id: string) => void;
}) {
  const navigate = useOptionalNavigate();
  const remainingRef = useRef<number>(initialRemainingMs);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const snapshotRemaining = useCallback(() => {
    if (startedAtRef.current !== null) {
      const elapsed = Date.now() - startedAtRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      startedAtRef.current = null;
    }
    onSaveRemaining(popup.id, remainingRef.current);
  }, [onSaveRemaining, popup.id]);

  const scheduleTimer = useCallback(() => {
    clearTimer();
    if (pausedRef.current) return;
    if (remainingRef.current <= 0) {
      onDismiss(popup.id);
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      remainingRef.current = 0;
      startedAtRef.current = null;
      onSaveRemaining(popup.id, 0);
      onDismiss(popup.id);
    }, remainingRef.current);
  }, [clearTimer, onDismiss, onSaveRemaining, popup.id]);

  const pauseTimer = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    snapshotRemaining();
    clearTimer();
  }, [clearTimer, snapshotRemaining]);

  const resumeTimer = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    scheduleTimer();
  }, [scheduleTimer]);

  useEffect(() => {
    scheduleTimer();
    return () => {
      snapshotRemaining();
      clearTimer();
    };
  }, [scheduleTimer, snapshotRemaining, clearTimer]);

  const petToShow = popup.kind === "pet" ? (popup.pet ?? activePet) : null;

  return (
    <div
      data-testid="notification-popup-card"
      role="status"
      aria-live="polite"
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocusCapture={pauseTimer}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          resumeTimer();
        }
      }}
      className="glass-panel pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border px-3.5 py-2.5 text-sm text-foreground shadow-lg"
    >
      {skinId ? (
        <motion.div
          initial={reduced ? false : { y: 0 }}
          animate={reduced ? { y: 0 } : { y: [0, -5, 0] }}
          transition={{ duration: reduced ? 0 : 0.35, ease }}
          className="shrink-0"
        >
          {petToShow ? (
            <PetLayer
              itemKey={`${petToShow.speciesKey}:${petToShow.variantKey}`}
              className="game-pixel-art size-8 shrink-0 rounded-lg border border-border bg-card p-0.5"
            />
          ) : (
            <AvatarStage
              style={skinId}
              size={32}
              level={level}
              profile={profile}
              equipped={skinId === "game" ? equipped : undefined}
              pet={activePet}
              mounted={mounted}
              className="rounded-lg border border-border"
            />
          )}
        </motion.div>
      ) : (
        <div
          data-testid="notification-popup-icon"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <NotificationKindIcon kind={popup.kind} className="size-4 shrink-0 text-primary" />
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-0.5">
        {popup.link ? (
          <button
            type="button"
            onClick={() => {
              navigateToNotificationLink(popup.link!, navigate);
              onDismiss(popup.id);
            }}
            className="block w-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs font-semibold text-primary hover:underline">{popup.title}</p>
            <p className="break-words text-sm leading-snug text-foreground">{popup.body}</p>
          </button>
        ) : (
          <>
            <p className="text-xs font-semibold text-primary">{popup.title}</p>
            <p className="break-words text-sm leading-snug text-foreground">{popup.body}</p>
          </>
        )}
        {popup.action && (
          <button
            type="button"
            onClick={() => {
              popup.action?.onClick();
              onDismiss(popup.id);
            }}
            className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {popup.action.label}
          </button>
        )}
      </div>

      <button
        type="button"
        aria-label={t("notifications.popup.dismiss")}
        onClick={() => onDismiss(popup.id)}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Unified top inline-end pop-up host below the app header and screen toolbars.
 * Stacks at most 3 items, defers to queued state while any dialog/menu/popover
 * or overlapping study card is open, auto-hides after 3–5s, pauses on hover/focus,
 * and dismisses on Esc.
 */
function SkinAvatarQueryBridge({
  skinId,
  onData,
}: {
  skinId: "game" | "scholar";
  onData: (data: {
    level: number;
    profile: AvatarProfileDto | null;
    equipped: EquippedSlotDto[] | null;
    activePet: { speciesKey: string; variantKey: string } | null;
    mounted: boolean;
  }) => void;
}) {
  const gameQuery = useGameState(true);
  const depthQuery = useGameDepthState(skinId === "game");
  const progressQuery = useProgressSummary(skinId === "scholar");

  useEffect(() => {
    const level =
      skinId === "scholar"
        ? (progressQuery.data?.level ?? gameQuery.data?.level ?? 1)
        : (gameQuery.data?.level ?? 1);
    const profile = gameQuery.data?.avatar ?? null;
    const equipped = gameQuery.data?.equipped ?? null;
    const petRow =
      depthQuery.data?.pets.find((p) => p.id === depthQuery.data?.active_pet_id) ?? null;
    const activePet = petRow
      ? { speciesKey: petRow.species_key, variantKey: petRow.variant_key }
      : null;
    const mounted = depthQuery.data?.mounted ?? false;
    onData({ level, profile, equipped, activePet, mounted });
  }, [skinId, gameQuery.data, depthQuery.data, progressQuery.data, onData]);

  return null;
}

export function NotificationToastHost() {
  const popupQueue = useNotificationStore((s) => s.popupQueue);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const dismissPopup = useNotificationStore((s) => s.dismissPopup);
  const dismissVisiblePopups = useNotificationStore((s) => s.dismissVisiblePopups);

  const style = useStyle((s) => s.style);
  const skin = getStyleSkin(style);
  const reduced = Boolean(useReducedMotion());
  const queryClient = useContext(QueryClientContext);

  const tauri = isTauri();
  const activeSkin = Boolean(queryClient && tauri && skin);
  const [skinAvatarData, setSkinAvatarData] = useState<{
    level: number;
    profile: AvatarProfileDto | null;
    equipped: EquippedSlotDto[] | null;
    activePet: { speciesKey: string; variantKey: string } | null;
    mounted: boolean;
  }>({
    level: 1,
    profile: null,
    equipped: null,
    activePet: null,
    mounted: false,
  });

  const [topOffset, setTopOffset] = useState<number>(() => computePopupTopOffset());
  const [blocked, setBlocked] = useState<boolean>(() =>
    hasBlockingLayer(panelOpen, computePopupTopOffset()),
  );
  const remainingMsByIdRef = useRef<Map<string, number>>(new Map());

  const handleSaveRemaining = useCallback((id: string, remainingMs: number) => {
    remainingMsByIdRef.current.set(id, remainingMs);
  }, []);

  useEffect(() => {
    const activeIds = new Set(popupQueue.map((p) => p.id));
    for (const id of remainingMsByIdRef.current.keys()) {
      if (!activeIds.has(id)) {
        remainingMsByIdRef.current.delete(id);
      }
    }
  }, [popupQueue]);

  useLayoutEffect(() => {
    const update = () => {
      const nextTop = computePopupTopOffset();
      setTopOffset(nextTop);
      setBlocked(hasBlockingLayer(panelOpen, nextTop));
    };
    update();
    if (typeof document === "undefined") return;

    const mainEl = document.getElementById("main-content");
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && mainEl ? new ResizeObserver(update) : null;
    if (resizeObserver && mainEl) {
      resizeObserver.observe(mainEl);
      for (const bar of mainEl.querySelectorAll(TOP_TOOLBAR_SELECTOR)) {
        resizeObserver.observe(bar);
      }
      for (const cta of document.querySelectorAll(AVOID_CTA_SELECTOR)) {
        resizeObserver.observe(cta);
      }
    }

    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(update) : null;
    observer?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "role",
        "aria-modal",
        "class",
        "data-testid",
        "data-style",
        "data-toast-anchor",
        "data-toast-avoid",
      ],
    });
    window.addEventListener("resize", update);
    return () => {
      resizeObserver?.disconnect();
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [panelOpen, style]);

  const visible = useMemo(
    () => (blocked ? [] : popupQueue.slice(0, MAX_VISIBLE_POPUPS)),
    [blocked, popupQueue],
  );

  useEffect(() => {
    if (blocked || visible.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismissVisiblePopups(visible.map((p) => p.id));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blocked, visible, dismissVisiblePopups]);

  if (visible.length === 0) {
    return activeSkin && skin ? (
      <SkinAvatarQueryBridge skinId={skin.id} onData={setSkinAvatarData} />
    ) : null;
  }

  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const { level, profile, equipped, activePet, mounted } = skinAvatarData;

  const hostNode = (
    <div
      data-testid="notification-toast-host"
      role="region"
      aria-label={t("notifications.popup.regionAria")}
      style={{ top: `${topOffset}px` }}
      className="pointer-events-none fixed end-4 z-[25] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {visible.map((popup) => (
          <motion.div
            key={popup.id}
            initial={reduced ? { opacity: 1, x: 0 } : { opacity: 0, x: isRtl ? -16 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: reduced ? 0 : dur.fast, ease } }}
            transition={{ duration: reduced ? 0 : dur.fast, ease }}
          >
            <PopupCardContent
              popup={popup}
              initialRemainingMs={remainingMsByIdRef.current.get(popup.id) ?? popup.durationMs}
              onSaveRemaining={handleSaveRemaining}
              reduced={reduced}
              skinId={skin?.id ?? null}
              level={level}
              profile={profile}
              equipped={equipped}
              activePet={activePet}
              mounted={mounted}
              onDismiss={dismissPopup}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {activeSkin && skin && <SkinAvatarQueryBridge skinId={skin.id} onData={setSkinAvatarData} />}
      {typeof document !== "undefined" ? createPortal(hostNode, document.body) : hostNode}
    </>
  );
}
