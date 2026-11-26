import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Eye, RotateCcw } from "lucide-react";
import { CardFace } from "@/components/CardFace";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useTheme } from "@/stores/theme";
import { DialogFrame } from "./DialogFrame";

export function CardPreviewDialog({
  open,
  cardIds,
  onClose,
}: {
  open: boolean;
  cardIds: number[];
  onClose: () => void;
}) {
  const tauri = isTauri();
  const night = useTheme((s) => s.resolved) === "dark";
  const [index, setIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);

  const selectionKey = cardIds.join(",");
  useEffect(() => {
    if (open) {
      setIndex(0);
      setShowBack(false);
    }
  }, [open, selectionKey]);

  const currentId = cardIds[index] ?? null;

  const previewQuery = useQuery({
    queryKey: queryKeys.cardsPreview(currentId),
    queryFn: () => ipc.previewCard(currentId!),
    enabled: open && tauri && currentId !== null,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const onButton = target?.closest("button") !== null;
      if (e.key === "ArrowRight" && index < cardIds.length - 1) {
        e.preventDefault();
        setIndex((i) => Math.min(cardIds.length - 1, i + 1));
        setShowBack(false);
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
        setShowBack(false);
      } else if (e.key === " " && !onButton) {
        e.preventDefault();
        setShowBack((b) => !b);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, index, cardIds.length]);

  return (
    <DialogFrame
      open={open}
      title={t("browse.preview.title")}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Eye className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("browse.preview.title")}</h2>
        </div>
        {cardIds.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("browse.preview.counter", { current: index + 1, total: cardIds.length })}
          </span>
        )}
      </div>

      <div className="mb-4 min-h-56 max-h-[60vh] overflow-auto rounded-lg border border-border bg-background p-4">
        {previewQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : previewQuery.isError ? (
          <p className="text-sm text-destructive">
            {String((previewQuery.error as Error).message)}
          </p>
        ) : previewQuery.data ? (
          <CardFace
            html={showBack ? previewQuery.data.answer : previewQuery.data.question}
            css={previewQuery.data.css}
            tauri={tauri}
            night={night}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index <= 0}
            onClick={() => {
              setIndex((i) => Math.max(0, i - 1));
              setShowBack(false);
            }}
          >
            <ArrowLeft className="size-3.5 rtl:-scale-x-100" />
            {t("browse.preview.previous")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index >= cardIds.length - 1}
            onClick={() => {
              setIndex((i) => Math.min(cardIds.length - 1, i + 1));
              setShowBack(false);
            }}
          >
            {t("browse.preview.next")}
            <ArrowRight className="size-3.5 rtl:-scale-x-100" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowBack((b) => !b)}
            disabled={!previewQuery.data}
          >
            <RotateCcw className="size-3.5" />
            {showBack ? t("browse.preview.showQuestion") : t("study.showAnswer")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </DialogFrame>
  );
}
