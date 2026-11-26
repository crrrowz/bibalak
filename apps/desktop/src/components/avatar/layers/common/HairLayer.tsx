import type { SVGProps } from "react";

export interface HairLayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
  hairColor?: string;
}

const HAIR_COLORS: Record<string, { main: string; hi: string }> = {
  black: { main: "#23202A", hi: "#3C3747" },
  brown: { main: "#5B3B26", hi: "#7B5338" },
  auburn: { main: "#8E3A24", hi: "#B55236" },
  blonde: { main: "#D4A74A", hi: "#EDD07C" },
  silver: { main: "#9EA6B8", hi: "#CAD2E0" },
  indigo: { main: "#3E3F8C", hi: "#5F61B8" },
};

export function HairLayer({ itemKey, hairColor = "black", ...props }: HairLayerProps) {
  const pal = HAIR_COLORS[hairColor] ?? HAIR_COLORS.black;

  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="hair"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "hair_1" && (
        <>
          <rect x="5" y="2" width="6" height="2" fill={pal.main} />
          <rect x="6" y="2" width="3" height="1" fill={pal.hi} />
          <rect x="5" y="4" width="1" height="1" fill={pal.main} />
        </>
      )}
      {itemKey === "hair_2" && (
        <>
          <rect x="4" y="2" width="8" height="2" fill={pal.main} />
          <rect x="4" y="4" width="1" height="4" fill={pal.main} />
          <rect x="11" y="4" width="1" height="4" fill={pal.main} />
          <rect x="6" y="2" width="4" height="1" fill={pal.hi} />
        </>
      )}
      {itemKey === "hair_3" && (
        <>
          <rect x="5" y="1" width="2" height="1" fill={pal.main} />
          <rect x="8" y="1" width="2" height="1" fill={pal.hi} />
          <rect x="4" y="2" width="8" height="2" fill={pal.main} />
          <rect x="10" y="4" width="1" height="1" fill={pal.main} />
        </>
      )}
      {itemKey === "hair_4" && (
        <>
          <rect x="4" y="2" width="8" height="2" fill={pal.main} />
          <rect x="4" y="4" width="1" height="3" fill={pal.main} />
          <rect x="11" y="4" width="1" height="3" fill={pal.main} />
          <rect x="5" y="1" width="6" height="1" fill={pal.hi} />
        </>
      )}
      {itemKey === "hair_5" && (
        <>
          <rect x="5" y="2" width="6" height="1" fill={pal.hi} />
          <rect x="4" y="3" width="1" height="2" fill={pal.main} />
          <rect x="11" y="3" width="1" height="2" fill={pal.main} />
        </>
      )}
      {itemKey === "hair_6" && (
        <>
          <rect x="4" y="2" width="8" height="2" fill={pal.main} />
          <rect x="6" y="1" width="4" height="1" fill={pal.hi} />
          <rect x="4" y="4" width="1" height="5" fill={pal.main} />
          <rect x="11" y="4" width="1" height="5" fill={pal.main} />
        </>
      )}
    </svg>
  );
}
