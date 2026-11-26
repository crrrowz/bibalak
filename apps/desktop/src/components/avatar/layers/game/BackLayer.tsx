import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function BackLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="back"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "back_satchel_canvas" && (
        <>
          <rect x="3" y="9" width="2" height="4" fill="#9A7B56" />
          <rect x="3" y="9" width="2" height="1" fill="#6F5638" />
        </>
      )}
      {itemKey === "back_cape_crimson" && (
        <>
          <rect x="3" y="8" width="10" height="6" fill="#9E2A3B" />
          <rect x="4" y="13" width="8" height="1" fill="#781E2B" />
        </>
      )}
      {itemKey === "back_mantle_star" && (
        <>
          <rect x="3" y="8" width="10" height="6" fill="#312E81" />
          <rect x="4" y="10" width="1" height="1" fill="#FDE047" />
          <rect x="11" y="12" width="1" height="1" fill="#FDE047" />
        </>
      )}
    </svg>
  );
}
