interface LogoProps {
  size?: number;
  showWordmark?: boolean;
}

/** App mark (same full-color tile in both themes) plus optional wordmark. */
export function Logo({ size = 18, showWordmark = true }: LogoProps) {
  return (
    <div className="flex items-center gap-2">
      <img src="/logos/bibalak-icon.svg" alt="Bibalak" style={{ height: size, width: size }} />
      {showWordmark && (
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Bibalak</span>
      )}
    </div>
  );
}
