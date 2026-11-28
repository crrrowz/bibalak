import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GameStateDto, MotivationStateDto, SpendHistoryEntryDto } from "@bibalak/ipc-types";
import { formatNumber, t } from "@/lib/i18n";
import { spendEntryLabel } from "@/features/game/itemTitle";
import { queryKeys } from "@/lib/queryKeys";
import { useStyle } from "@/stores/style";
import { processMotivationSnapshot } from "./motivationNotifications";
import { pushNotification } from "./notificationStore";

function sameKey(queryKey: readonly unknown[], expected: readonly unknown[]): boolean {
  return (
    queryKey.length === expected.length && queryKey.every((part, idx) => part === expected[idx])
  );
}

/**
 * Watches TanStack Query cache updates for purchases, refunds, and streak-freeze
 * usage so events write to the notification store regardless of which screen
 * mutated them, with deduplication against explicit progress toasts.
 */
export function NotificationEventWatcher() {
  const queryClient = useQueryClient();
  const seenSpendsRef = useRef<Map<string, SpendHistoryEntryDto> | null>(null);
  const lastFreezeHeldRef = useRef<number | null>(null);
  const prevMotivationRef = useRef<MotivationStateDto | null>(null);
  const recentRefundAtRef = useRef<number>(0);
  const recentAutoFreezeAtRef = useRef<number>(0);

  useEffect(() => {
    const initialSpend = queryClient.getQueryData<SpendHistoryEntryDto[]>(queryKeys.spendHistory);
    if (Array.isArray(initialSpend) && seenSpendsRef.current === null) {
      seenSpendsRef.current = new Map(initialSpend.map((e) => [e.spend_id, e]));
    }
    const initialGame = queryClient.getQueryData<GameStateDto>(queryKeys.gameState);
    if (initialGame && lastFreezeHeldRef.current === null) {
      lastFreezeHeldRef.current = initialGame.freeze_tokens_held;
    }
    const initialMotivation = queryClient.getQueryData<MotivationStateDto>(
      queryKeys.motivationState,
    );
    if (initialMotivation && prevMotivationRef.current === null) {
      prevMotivationRef.current = initialMotivation;
    }

    const cache = queryClient.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;

      const key = event.query.queryKey;
      const data = event.query.state.data;

      if (sameKey(key, queryKeys.spendHistory) && Array.isArray(data)) {
        const entries = data as SpendHistoryEntryDto[];
        const nextMap = new Map(entries.map((e) => [e.spend_id, e]));
        const prevMap = seenSpendsRef.current;

        if (prevMap === null) {
          seenSpendsRef.current = nextMap;
          return;
        }

        for (const entry of entries) {
          if (!prevMap.has(entry.spend_id)) {
            const gold = formatNumber(Math.round(entry.amount_cents / 100));
            pushNotification({
              kind: "purchase",
              title: t("notifications.kind.purchase"),
              body: t("game.shop.purchasedToast", { item: spendEntryLabel(entry), gold }),
              link: "/shop",
              dedupeKey: `spend:${entry.spend_id}`,
            });
          }
        }

        for (const [oldId, oldEntry] of prevMap) {
          if (!nextMap.has(oldId)) {
            recentRefundAtRef.current = Date.now();
            const gold = formatNumber(Math.round(oldEntry.amount_cents / 100));
            pushNotification({
              kind: "refund",
              title: t("notifications.kind.refund"),
              body: t("game.shop.refundedToast", { item: spendEntryLabel(oldEntry), gold }),
              link: "/shop",
              dedupeKey: `refund:${oldId}`,
            });
          }
        }

        seenSpendsRef.current = nextMap;
        return;
      }

      if (sameKey(key, queryKeys.gameState) && data && typeof data === "object") {
        const gs = data as GameStateDto;
        const prev = lastFreezeHeldRef.current;
        if (prev === null) {
          lastFreezeHeldRef.current = gs.freeze_tokens_held;
          return;
        }
        if (
          gs.freeze_tokens_held < prev &&
          Date.now() - recentRefundAtRef.current > 2000 &&
          Date.now() - recentAutoFreezeAtRef.current > 2000
        ) {
          const dayKey =
            prevMotivationRef.current?.today_day_index ?? new Date().toISOString().slice(0, 10);
          const onStreakPage =
            typeof window !== "undefined" && window.location.pathname.startsWith("/streak");
          pushNotification({
            kind: "freeze",
            title: t("notifications.kind.freeze"),
            body: t("notifications.kind.freezeBody"),
            link: onStreakPage ? "/streak" : "/plan/habits",
            dedupeKey: `freeze:${dayKey}:${gs.freeze_tokens_held}`,
          });
        }
        lastFreezeHeldRef.current = gs.freeze_tokens_held;
        return;
      }

      if (sameKey(key, queryKeys.motivationState) && data && typeof data === "object") {
        const nextMotivation = data as MotivationStateDto;
        const { autoFrozeNow } = processMotivationSnapshot(
          prevMotivationRef.current,
          nextMotivation,
          useStyle.getState().style,
        );
        if (autoFrozeNow) {
          recentAutoFreezeAtRef.current = Date.now();
        }
        prevMotivationRef.current = nextMotivation;
      }
    });
  }, [queryClient]);

  return null;
}
