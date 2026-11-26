import { useEffect, useRef, useState } from "react";
import { ExternalLink, Pause, Play, X } from "lucide-react";
import type { MediaLibraryItem } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { MediaKindIcon } from "@/features/media/MediaKindIcon";
import { formatNumber, tn, t } from "@/lib/i18n";
import { formatBytes, mediaKindLabel, mediaUrl } from "@/lib/media";
import { useSound } from "@/stores/sound";

function formatAudioTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  const minStr = formatNumber(mins, { useGrouping: false });
  const secStr = formatNumber(secs, { minimumIntegerDigits: 2, useGrouping: false });
  return `${minStr}:${secStr}`;
}

interface MediaPreviewPanelProps {
  item: MediaLibraryItem;
  onClose: () => void;
  onShowNotes: (filename: string) => void;
}

/** Side/sheet preview panel for inspecting a selected media file safely. */
export function MediaPreviewPanel({ item, onClose, onShowNotes }: MediaPreviewPanelProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const mediaElRef = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const effectiveVolume = useSound((s) => s.effectiveVolume);

  useEffect(() => {
    if (mediaElRef.current) {
      mediaElRef.current.volume = effectiveVolume;
    }
  }, [effectiveVolume, item.filename]);

  useEffect(() => {
    setImgFailed(false);
    setAudioFailed(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [item.filename]);

  useEffect(() => {
    const mediaEl = mediaElRef.current;
    return () => {
      if (mediaEl) {
        mediaEl.pause();
      }
    };
  }, [item.filename]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        mediaElRef.current?.pause();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const src = mediaUrl(item.filename);

  return (
    <aside
      role="region"
      aria-label={t("media.preview.title")}
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[75vh] flex-col gap-4 overflow-y-auto rounded-t-xl border-t border-border bg-card p-4 shadow-lg lg:static lg:z-auto lg:max-h-none lg:w-80 lg:shrink-0 lg:self-start lg:rounded-lg lg:border lg:shadow-none xl:w-96"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t("media.preview.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("common.close")}
          onClick={() => {
            mediaElRef.current?.pause();
            onClose();
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex min-h-44 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40 p-3">
        {item.kind === "image" && !imgFailed ? (
          <img
            src={src}
            alt={item.filename}
            onError={() => setImgFailed(true)}
            className="max-h-64 w-full object-contain"
          />
        ) : item.kind === "audio" ? (
          <div className="flex w-full flex-col items-center gap-3">
            <MediaKindIcon kind="audio" className="size-10" />
            <audio
              key={item.filename}
              ref={mediaElRef}
              src={src}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                setDuration(Number.isFinite(d) && d > 0 ? d : 0);
                e.currentTarget.volume = effectiveVolume;
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setAudioFailed(true)}
              className="hidden"
            />
            {audioFailed ? (
              <span className="text-xs font-medium text-destructive">
                {t("media.player.loadError")}
              </span>
            ) : (
              <div className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={playing ? t("media.player.pause") : t("media.player.play")}
                  title={playing ? t("media.player.pause") : t("media.player.play")}
                  onClick={() => {
                    const el = mediaElRef.current;
                    if (!el) return;
                    if (playing) {
                      el.pause();
                    } else {
                      void el.play();
                    }
                  }}
                >
                  {playing ? (
                    <Pause className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Play className="size-3.5" aria-hidden="true" />
                  )}
                </Button>

                <input
                  type="range"
                  role="slider"
                  aria-label={t("media.player.timeline")}
                  min={0}
                  max={duration > 0 ? duration : 0}
                  step={0.1}
                  value={Math.min(currentTime, duration > 0 ? duration : currentTime)}
                  aria-valuemin={0}
                  aria-valuemax={Math.floor(duration)}
                  aria-valuenow={Math.floor(currentTime)}
                  aria-valuetext={formatAudioTime(currentTime)}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setCurrentTime(next);
                    if (mediaElRef.current) {
                      mediaElRef.current.currentTime = next;
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const dir = document.documentElement.dir === "rtl" ? -1 : 1;
                      const delta = (e.key === "ArrowRight" ? 5 : -5) * dir;
                      const max = duration > 0 ? duration : Infinity;
                      const next = Math.max(0, Math.min(max, currentTime + delta));
                      setCurrentTime(next);
                      if (mediaElRef.current) {
                        mediaElRef.current.currentTime = next;
                      }
                    }
                  }}
                  className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-secondary accent-primary"
                />

                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <bdi dir="ltr">
                    {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
                  </bdi>
                </span>
              </div>
            )}
          </div>
        ) : item.kind === "video" ? (
          <video
            key={item.filename}
            ref={mediaElRef}
            controls
            src={src}
            className="max-h-64 w-full rounded bg-black/90"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <MediaKindIcon kind={item.kind} className="size-10" />
            <span className="text-xs font-medium text-muted-foreground">
              {item.kind === "image" ? t("media.preview.emptyFallback") : mediaKindLabel(item.kind)}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="break-all text-start text-sm font-medium text-foreground">
          <bdi dir="auto">{item.filename}</bdi>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
            {mediaKindLabel(item.kind)}
          </span>
          <span className="tabular-nums">
            <bdi dir="ltr">{formatBytes(item.size_bytes)}</bdi>
          </span>
          <span
            className={
              item.usage_count === 0
                ? "rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground"
                : "rounded bg-primary/10 px-2 py-0.5 font-medium text-primary tabular-nums"
            }
          >
            {item.usage_count === 0
              ? t("media.unusedBadge")
              : tn("media.usageCount", item.usage_count)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={item.usage_count === 0}
          title={item.usage_count === 0 ? t("media.preview.unusedHint") : undefined}
          onClick={() => onShowNotes(item.filename)}
        >
          <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
          {t("media.preview.showNotes")}
        </Button>
        {item.usage_count === 0 && (
          <p className="text-center text-xs text-muted-foreground">
            {t("media.preview.unusedHint")}
          </p>
        )}
      </div>
    </aside>
  );
}
