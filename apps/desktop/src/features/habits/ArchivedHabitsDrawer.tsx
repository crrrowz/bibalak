import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArchiveRestore, Trash2 } from "lucide-react";
import type { HabitDto } from "@bibalak/ipc-types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { ipc, isTauri } from "@/lib/ipc";
import { formatDate, t } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { styleKey, type PresentationStyleOrGame } from "@/lib/styles/styleKey";
import { HabitIconGlyph } from "./CreateHabitDialog";
import { formatHabitFrequency } from "./habitHelpers";

interface ArchivedHabitsDrawerProps {
  open: boolean;
  style: PresentationStyleOrGame;
  isMutating?: boolean;
  onRestore: (habit: HabitDto) => void;
  onDelete: (habit: HabitDto) => void;
  onClose: () => void;
}

export function ArchivedHabitsDrawer({
  open,
  style,
  isMutating = false,
  onRestore,
  onDelete,
  onClose,
}: ArchivedHabitsDrawerProps) {
  const tauri = isTauri();
  const [confirmDelete, setConfirmDelete] = useState<HabitDto | null>(null);

  const archivedQuery = useQuery({
    queryKey: queryKeys.archivedHabits,
    queryFn: ipc.listArchivedHabits,
    enabled: tauri && open,
  });

  const archived = archivedQuery.data ?? [];

  return (
    <>
      <SidePanel open={open} title={t("habits.archived.title")} width={420} onClose={onClose}>
        <div className="space-y-3 p-4">
          {archivedQuery.isLoading ? (
            <div data-testid="archived-habits-loading" className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl border border-border bg-secondary/40"
                />
              ))}
            </div>
          ) : archivedQuery.isError ? (
            <div className="space-y-3 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
              <p>{t("habits.error")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void archivedQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : archived.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t(styleKey("habits.archived.empty", style))}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {archived.map((habit) => (
                <li
                  key={habit.id}
                  data-testid={`archived-habit-${habit.id}`}
                  className="rounded-xl border border-border bg-background/60 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/40 text-muted-foreground">
                        <HabitIconGlyph iconKey={habit.icon_key} className="size-4" />
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <p dir="auto" className="truncate text-sm font-medium text-foreground">
                          {habit.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatHabitFrequency(habit)}
                          {habit.archived_at !== null && (
                            <>
                              {" · "}
                              {t("habits.archived.archivedOn", {
                                date: formatDate(new Date(habit.archived_at), {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                }),
                              })}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isMutating}
                      onClick={() => onRestore(habit)}
                    >
                      <ArchiveRestore className="size-3.5" />
                      {t("habits.archived.restore")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isMutating}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmDelete(habit)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("habits.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SidePanel>

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title={t("habits.archived.deleteTitle")}
          description={t("habits.archived.deleteConfirm", { title: confirmDelete.title })}
          confirmLabel={t("habits.delete")}
          isPending={isMutating}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            onDelete(target);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
