import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateTodayCounts } from "@/lib/queryRefresh";
import { formatUndoAction } from "@/lib/undo";
import { toast } from "@/stores/toast";

/**
 * In-memory undo history screen (newest first, 20 items per page) allowing
 * one-click Undo on the newest action while preserving Undo order.
 */
export function ActivityScreen() {
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);

  const historyQuery = useQuery({
    queryKey: queryKeys.undoHistory(page),
    queryFn: () => ipc.undoHistory(page),
    enabled: tauri,
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: (undone) => {
      if (undone) {
        toast.info(t("study.toast.undone", { action: formatUndoAction(undone) }));
      }
      void invalidateTodayCounts(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.undoHistoryAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.habitsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

  const data = historyQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 0;
  const hasNext = (page + 1) * pageSize < total;

  return (
    <div className="relative flex h-full flex-col">
      <ScreenHeader title={t("activity.title")} description={t("activity.description")} />

      <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 lg:px-8">
        {historyQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(historyQuery.error)}
          </p>
        ) : historyQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title={t("activity.emptyTitle")}
            description={t("activity.empty")}
          />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <ul
              data-testid="activity-list"
              className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
            >
              {items.map((item, idx) => (
                <li
                  key={`${page}-${idx}-${item.created_at_ms}-${item.action.kind}`}
                  data-testid="activity-row"
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {formatUndoAction(item.action)}
                    </p>
                    <p className="tnum text-xs text-muted-foreground">
                      {formatDate(item.created_at_ms, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {item.can_undo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={undoMut.isPending}
                      onClick={() => undoMut.mutate()}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      {t("decks.undo")}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("activity.undoNewerFirst")}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <div
              data-testid="activity-pagination"
              className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
            >
              <span className="tnum">
                {t("activity.pageSummary", {
                  page: formatNumber(page + 1),
                  totalPages: formatNumber(totalPages),
                  total: formatNumber(total),
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  {t("activity.previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("activity.next")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
