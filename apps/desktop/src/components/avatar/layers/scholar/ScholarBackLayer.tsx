import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function ScholarBackLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="back"
      data-item={itemKey}
      {...props}
    >
      {/* Researcher+ leather satchel */}
      <rect x="3" y="9" width="2" height="4" fill="#7C4D2B" />
      <rect x="3" y="9" width="2" height="1" fill="#5A361D" />
      <rect x="3" y="11" width="1" height="1" fill="#D4A74A" />
    </svg>
  );
}
