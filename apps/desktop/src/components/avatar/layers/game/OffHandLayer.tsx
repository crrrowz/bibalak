import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function OffHandLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="off_hand"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "off_lantern_warm" && (
        <>
          <rect x="2" y="9" width="2" height="1" fill="#92400E" />
          <rect x="2" y="10" width="2" height="2" fill="#FBBF24" />
          <rect x="2" y="12" width="2" height="1" fill="#78350F" />
        </>
      )}
      {itemKey === "off_buckler_oak" && (
        <>
          <rect x="2" y="9" width="3" height="4" fill="#8B5A2B" />
          <rect x="3" y="10" width="1" height="2" fill="#D4A74A" />
        </>
      )}
      {itemKey === "off_tome_runed" && (
        <>
          <rect x="2" y="9" width="3" height="4" fill="#4C1D95" />
          <rect x="3" y="10" width="1" height="2" fill="#38BDF8" />
        </>
      )}
    </svg>
  );
}
