import type { RefObject } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { formatNumber, t } from "@/lib/i18n";
import { useSound } from "@/stores/sound";
import { FooterPopoverShell } from "./FooterPopoverShell";

export interface VolumePopoverProps {
  open: boolean;
  compact: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

interface ChannelSliderProps {
  id: string;
  label: string;
  volume: number;
  muted: boolean;
  muteLabel: string;
  unmuteLabel: string;
  onVolumeChange: (next: number) => void;
  onToggleMute: () => void;
}

function ChannelSlider({
  id,
  label,
  volume,
  muted,
  muteLabel,
  unmuteLabel,
  onVolumeChange,
  onToggleMute,
}: ChannelSliderProps) {
  const effective = muted ? 0 : volume;
  const pctLabel = `${formatNumber(effective)}%`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <span className="min-w-[3ch] text-end text-xs tabular-nums text-muted-foreground">
            {pctLabel}
          </span>
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? unmuteLabel : muteLabel}
            aria-pressed={muted}
            title={muted ? unmuteLabel : muteLabel}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-3.5" aria-hidden="true" />
            ) : (
              <Volume2 className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={effective}
        aria-valuetext={pctLabel}
        value={effective}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        onKeyDown={(e) => {
          const isRtl = document.documentElement.dir === "rtl";
          let delta = 0;
          if (e.key === "ArrowUp") delta = 1;
          else if (e.key === "ArrowDown") delta = -1;
          else if (e.key === "ArrowRight") delta = isRtl ? -1 : 1;
          else if (e.key === "ArrowLeft") delta = isRtl ? 1 : -1;
          if (delta !== 0) {
            e.preventDefault();
            e.stopPropagation();
            onVolumeChange(Math.max(0, Math.min(100, effective + delta)));
          }
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </div>
  );
}

/**
 * Dual-channel volume pop-over anchored to the sidebar footer sound button.
 * Controls Card audio and App sounds independently with keyboard, pointer, and
 * touch accessibility.
 */
export function VolumePopover({ open, compact, anchorRef, onClose }: VolumePopoverProps) {
  const cardVolume = useSound((s) => s.cardVolume);
  const cardMuted = useSound((s) => s.cardMuted);
  const setCardVolume = useSound((s) => s.setCardVolume);
  const setCardMuted = useSound((s) => s.setCardMuted);
  const toggleCardMute = useSound((s) => s.toggleCardMute);

  const appVolume = useSound((s) => s.appVolume);
  const appMuted = useSound((s) => s.appMuted);
  const setAppVolume = useSound((s) => s.setAppVolume);
  const setAppMuted = useSound((s) => s.setAppMuted);
  const toggleAppMute = useSound((s) => s.toggleAppMute);

  return (
    <FooterPopoverShell
      open={open}
      compact={compact}
      anchorRef={anchorRef}
      onClose={onClose}
      testId="volume-popover"
      ariaLabel={t("nav.sound")}
      estimatedWidth={compact ? 224 : 240}
    >
      <div className="space-y-3">
        <ChannelSlider
          id="quick-card-volume"
          label={t("settings.sound.cardVolume")}
          volume={cardVolume}
          muted={cardMuted}
          muteLabel={t("sound.muteCard")}
          unmuteLabel={t("sound.unmuteCard")}
          onVolumeChange={(next) => {
            setCardVolume(next);
            if (cardMuted && next > 0) setCardMuted(false);
          }}
          onToggleMute={toggleCardMute}
        />
        <div className="border-t border-border/60 pt-2.5">
          <ChannelSlider
            id="quick-app-volume"
            label={t("settings.sound.appVolume")}
            volume={appVolume}
            muted={appMuted}
            muteLabel={t("sound.muteApp")}
            unmuteLabel={t("sound.unmuteApp")}
            onVolumeChange={(next) => {
              setAppVolume(next);
              if (appMuted && next > 0) setAppMuted(false);
            }}
            onToggleMute={toggleAppMute}
          />
        </div>
      </div>
    </FooterPopoverShell>
  );
}
