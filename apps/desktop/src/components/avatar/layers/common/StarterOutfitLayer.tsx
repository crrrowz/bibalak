import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

const TUNICS: Record<string, { main: string; trim: string }> = {
  tunic_slate: { main: "#4D556E", trim: "#7480A3" },
  tunic_forest: { main: "#2E6A4E", trim: "#529B78" },
  tunic_ochre: { main: "#A66A2B", trim: "#D49B4E" },
};

export function StarterOutfitLayer({ itemKey, ...props }: LayerProps) {
  const tunic = TUNICS[itemKey] ?? TUNICS.tunic_slate;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="outfit"
      data-item={itemKey}
      {...props}
    >
      <rect x="5" y="8" width="6" height="5" fill={tunic.main} />
      <rect x="4" y="8" width="1" height="2" fill={tunic.main} />
      <rect x="11" y="8" width="1" height="2" fill={tunic.main} />
      <rect x="6" y="8" width="4" height="1" fill={tunic.trim} />
      <rect x="5" y="11" width="6" height="1" fill="#2A2422" />
      <rect x="7" y="11" width="2" height="1" fill="#D4A74A" />
    </svg>
  );
}
