import { useEffect, useMemo, useRef } from "react";
import type { UnlockEventDto } from "@bibalak/ipc-types";
import type { PetSpecies } from "@/components/avatar/layers/game/pets";
import {
  pushNotification,
  type NotificationKind,
} from "@/features/notifications/notificationStore";
import { formatNumber, t, tn } from "@/lib/i18n";
import { playStyleCue } from "@/lib/styleAudio";
import { useStyle } from "@/stores/style";
import {
  ACHIEVEMENT_LOCALE_MAP,
  COSMETIC_ITEM_LOCALE,
  PATH_UNLOCK_LEVEL,
  PET_SPECIES_LOCALE,
} from "./depthCatalog";
import { useAcknowledgeUnlocksMutation, useGameDepthState } from "./useGameDepth";

function describeUnlock(
  event: UnlockEventDto,
  isScholar: boolean,
): {
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  pet?: { speciesKey: string; variantKey: string } | null;
} {
  if (event.kind === "achievement") {
    const loc = ACHIEVEMENT_LOCALE_MAP[event.key];
    const body = loc
      ? t(isScholar && loc.scholarTitleKey ? loc.scholarTitleKey : loc.titleKey)
      : event.key;
    return {
      kind: "achievement",
      title: isScholar ? t("scholar.achievements.title") : t("game.depth.toast.achievementTitle"),
      body,
      link: "/character?tab=achievements",
    };
  }

  if (event.kind === "pet") {
    const [species, variant] = event.reward_ref.split(":");
    const speciesKey = PET_SPECIES_LOCALE[species as PetSpecies] ?? "game.depth.pets.owl";
    return {
      kind: "pet",
      title: t("game.depth.toast.unlockTitle"),
      body: t("game.depth.toast.petUnlocked", { name: t(speciesKey) }),
      link: "/character?tab=stable",
      pet: {
        speciesKey: species || "owl",
        variantKey: variant || "classic",
      },
    };
  }

  if (event.kind === "path_unlocked") {
    return {
      kind: "unlock",
      title: t("game.depth.toast.unlockTitle"),
      body: t("game.depth.toast.pathUnlocked", { level: formatNumber(PATH_UNLOCK_LEVEL) }),
      link: "/character?tab=paths",
    };
  }

  const itemKey = COSMETIC_ITEM_LOCALE[event.reward_ref];
  return {
    kind: "unlock",
    title: t("game.depth.toast.unlockTitle"),
    body: t("game.depth.toast.cosmeticUnlocked", {
      name: itemKey ? t(itemKey) : event.reward_ref,
    }),
    link: "/character?tab=wardrobe",
  };
}

/**
 * Headless bridge that forwards unseen unlocks and backfill summaries from
 * `useGameDepthState` into the unified notification store / pop-up host,
 * playing style cues and acknowledging unlocks once dismissed or auto-hidden.
 */
export function UnlockToastHost() {
  const style = useStyle((s) => s.style);
  const active = style === "game" || style === "scholar";
  const isScholar = style === "scholar";
  const depthQuery = useGameDepthState(active);
  const ackMutation = useAcknowledgeUnlocksMutation();
  const ackRef = useRef(ackMutation);
  ackRef.current = ackMutation;
  const cuedIdsRef = useRef<Set<string>>(new Set());
  const pendingAckRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unseen = useMemo(
    () => (active ? (depthQuery.data?.unseen_unlocks ?? []) : []),
    [active, depthQuery.data?.unseen_unlocks],
  );

  useEffect(() => {
    if (!active || !depthQuery.data?.backfill_applied) return;
    const earnedAchievements = depthQuery.data.achievements.filter((a) => a.unlocked).length;
    const count = (style === "game" ? depthQuery.data.pets.length : 0) + earnedAchievements;
    if (count <= 0) return;

    const title = isScholar
      ? t("notifications.kind.backfill.scholar")
      : t("notifications.kind.backfill.game");
    pushNotification({
      kind: "backfill",
      title,
      body: tn("game.depth.backfill.banner", count, { count: formatNumber(count) }),
      link: "/character?tab=achievements",
      dedupeKey: "backfill:applied",
      soundCue: null,
    });
  }, [active, depthQuery.data, isScholar, style]);

  useEffect(() => {
    if (!active || unseen.length === 0) return;

    const queueAck = (id: string) => {
      pendingAckRef.current.add(id);
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const ids = Array.from(pendingAckRef.current);
        pendingAckRef.current.clear();
        if (ids.length > 0) {
          ackRef.current.mutate(ids);
        }
      }, 0);
    };

    const fresh = unseen.filter((u) => !cuedIdsRef.current.has(u.id));
    if (fresh.length === 0) return;

    for (const event of fresh) {
      cuedIdsRef.current.add(event.id);
      const desc = describeUnlock(event, isScholar);
      pushNotification({
        kind: desc.kind,
        title: desc.title,
        body: desc.body,
        link: desc.link,
        pet: desc.pet,
        dedupeKey: `unlock:${event.id}`,
        soundCue: null,
        onDismiss: () => queueAck(event.id),
      });
    }

    if (fresh.some((u) => u.kind !== "achievement")) {
      playStyleCue("unlock");
    }
    if (fresh.some((u) => u.kind === "achievement")) {
      playStyleCue("achievement");
    }
  }, [active, isScholar, unseen]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  return null;
}
