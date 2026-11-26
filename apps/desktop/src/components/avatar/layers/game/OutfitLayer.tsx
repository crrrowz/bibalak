import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

const OUTFITS: Record<string, { body: string; trim: string; clasp: string }> = {
  outfit_cloak_green: { body: "#265C42", trim: "#468966", clasp: "#D4A74A" },
  outfit_coat_guild: { body: "#3C466D", trim: "#6876AC", clasp: "#E2E8F0" },
  outfit_robe_velvet: { body: "#432874", trim: "#7C52C9", clasp: "#FBBF24" },
  outfit_tunic_royal: { body: "#5B21B6", trim: "#F59E0B", clasp: "#FDE68A" },
};

export function OutfitLayer({ itemKey, ...props }: LayerProps) {
  const pal = OUTFITS[itemKey] ?? OUTFITS.outfit_cloak_green;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="outfit"
      data-item={itemKey}
      {...props}
    >
      <rect x="5" y="8" width="6" height="5" fill={pal.body} />
      <rect x="4" y="8" width="1" height="2" fill={pal.body} />
      <rect x="11" y="8" width="1" height="2" fill={pal.body} />
      <rect x="5" y="8" width="6" height="1" fill={pal.trim} />
      <rect x="7" y="9" width="2" height="1" fill={pal.clasp} />
      <rect x="5" y="12" width="6" height="1" fill={pal.trim} />
    </svg>
  );
}
