import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

const SKIN_TONES: Record<string, { base: string; shade: string }> = {
  tone_1: { base: "#FCE0C8", shade: "#E8BC98" },
  tone_2: { base: "#F2C6A0", shade: "#D49E76" },
  tone_3: { base: "#DDA576", shade: "#B97D50" },
  tone_4: { base: "#B87A4F", shade: "#935A34" },
  tone_5: { base: "#8C5432", shade: "#6B3B1E" },
  tone_6: { base: "#5C3520", shade: "#422212" },
};

export function BodyLayer({ itemKey, ...props }: LayerProps) {
  const tone = SKIN_TONES[itemKey] ?? SKIN_TONES.tone_1;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="body"
      data-item={itemKey}
      {...props}
    >
      {/* Head */}
      <rect x="5" y="3" width="6" height="5" fill={tone.base} />
      <rect x="5" y="7" width="6" height="1" fill={tone.shade} />
      {/* Eyes */}
      <rect x="6" y="5" width="1" height="1" fill="#1E1B24" />
      <rect x="9" y="5" width="1" height="1" fill="#1E1B24" />
      {/* Neck & Hands */}
      <rect x="7" y="8" width="2" height="1" fill={tone.shade} />
      <rect x="4" y="10" width="1" height="2" fill={tone.base} />
      <rect x="11" y="10" width="1" height="2" fill={tone.base} />
      {/* Legs & Boots */}
      <rect x="5" y="13" width="2" height="2" fill="#3B3647" />
      <rect x="9" y="13" width="2" height="2" fill="#3B3647" />
      <rect x="5" y="14" width="2" height="1" fill="#231F2C" />
      <rect x="9" y="14" width="2" height="1" fill="#231F2C" />
    </svg>
  );
}
