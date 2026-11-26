import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function ScholarHeadLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="head"
      data-item={itemKey}
      {...props}
    >
      {/* Assistant Professor+ tasselled mortarboard cap */}
      <rect x="4" y="2" width="8" height="1" fill="#1F2A3A" />
      <rect x="6" y="1" width="4" height="1" fill="#2A394F" />
      <rect x="11" y="3" width="1" height="2" fill="#D4A74A" />
    </svg>
  );
}
