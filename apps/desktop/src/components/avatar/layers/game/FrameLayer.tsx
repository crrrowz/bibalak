import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

const FRAME_COLORS: Record<string, string> = {
  frame_copper_ring: "#C87533",
  frame_path_vanguard: "#B91C1C",
  frame_path_sage: "#6D28D9",
  frame_path_scout: "#0F766E",
  frame_path_artisan: "#D97706",
};

export function FrameLayer({ itemKey, ...props }: LayerProps) {
  const color = FRAME_COLORS[itemKey] ?? FRAME_COLORS.frame_copper_ring;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="frame"
      data-item={itemKey}
      {...props}
    >
      <rect x="0" y="0" width="16" height="1" fill={color} />
      <rect x="0" y="15" width="16" height="1" fill={color} />
      <rect x="0" y="1" width="1" height="14" fill={color} />
      <rect x="15" y="1" width="1" height="14" fill={color} />
      <rect x="1" y="1" width="1" height="1" fill={color} opacity="0.85" />
      <rect x="14" y="1" width="1" height="1" fill={color} opacity="0.85" />
      <rect x="1" y="14" width="1" height="1" fill={color} opacity="0.85" />
      <rect x="14" y="14" width="1" height="1" fill={color} opacity="0.85" />
    </svg>
  );
}
