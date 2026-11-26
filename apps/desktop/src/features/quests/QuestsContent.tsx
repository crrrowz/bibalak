import { useContext, useEffect, useRef } from "react";
import { QueryClientContext, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useStyle, type Style } from "@/stores/style";
import { QuestsView } from "./QuestsView";

function QuestsContentWithQuery({ style }: { style: Style }) {
  const queryClient = useQueryClient();
  const markedSeenRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: queryKeys.motivationState,
    queryFn: () => ipc.getMotivationState(style),
  });

  useEffect(() => {
    const data = query.data;
    if (!data) return;

    const unseenMonths: string[] = [];
    if (data.monthly_badge.earned && !data.monthly_badge.seen) {
      unseenMonths.push(data.monthly_badge.month_key);
    }
    for (const badge of data.earned_monthly_badges) {
      if (!badge.seen && !unseenMonths.includes(badge.month_key)) {
        unseenMonths.push(badge.month_key);
      }
    }

    const toMark = unseenMonths.filter((m) => !markedSeenRef.current.has(m));
    if (toMark.length === 0) return;

    for (const monthKey of toMark) {
      markedSeenRef.current.add(monthKey);
    }

    void Promise.all(toMark.map((monthKey) => ipc.markMonthlyBadgeSeen(monthKey))).then(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    });
  }, [query.data, queryClient]);

  return (
    <QuestsView
      state={query.data}
      style={style}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}

/**
 * Shared content frame for `/quests` (3 daily quests, weekly quest, and
 * monthly badge gallery).
 */
export function QuestsContent() {
  const style = useStyle((s) => s.style);
  const queryClient = useContext(QueryClientContext);

  if (!queryClient || !isTauri()) {
    return <QuestsView state={undefined} style={style} isLoading={false} isError={false} />;
  }

  return <QuestsContentWithQuery style={style} />;
}
