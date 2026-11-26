import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

const BACKDROPS: Record<string, { sky: string; floor: string; accent: string; glow: string }> = {
  backdrop_lamp: {
    sky: "#2D253B",
    floor: "#4A3B32",
    accent: "#6B5344",
    glow: "#F7C873",
  },
  backdrop_scholar_library: {
    sky: "#2A364B",
    floor: "#574335",
    accent: "#7C5E48",
    glow: "#F2E2BA",
  },
  bg_night_library: {
    sky: "#1B1E38",
    floor: "#3A2D46",
    accent: "#5A4770",
    glow: "#A78BFA",
  },
  bg_mountain_camp: {
    sky: "#1E3345",
    floor: "#31493B",
    accent: "#4E6E58",
    glow: "#F59E0B",
  },
  bg_observatory: {
    sky: "#12172D",
    floor: "#262B47",
    accent: "#3F4975",
    glow: "#7DD3FC",
  },
  backdrop_study_hearth: {
    sky: "#3B2322",
    floor: "#5C3729",
    accent: "#8A4F34",
    glow: "#FDBA74",
  },
};

export function BackdropLayer({ itemKey, ...props }: LayerProps) {
  const palette = BACKDROPS[itemKey] ?? BACKDROPS.backdrop_lamp;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="backdrop"
      data-item={itemKey}
      {...props}
    >
      <rect x="0" y="0" width="16" height="12" fill={palette.sky} />
      <rect x="0" y="12" width="16" height="4" fill={palette.floor} />
      <rect x="0" y="11" width="16" height="1" fill={palette.accent} />
      {/* Subtle window / stars / lamp glow */}
      <rect x="2" y="2" width="1" height="1" fill={palette.glow} opacity="0.8" />
      <rect x="13" y="3" width="1" height="1" fill={palette.glow} opacity="0.65" />
      <rect x="12" y="8" width="2" height="3" fill={palette.accent} />
      <rect x="12" y="7" width="2" height="1" fill={palette.glow} />
    </svg>
  );
}
