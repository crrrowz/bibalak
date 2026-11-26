import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function HeadLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="head"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "head_hood_scholar" && (
        <>
          <rect x="4" y="2" width="8" height="2" fill="#3B425E" />
          <rect x="4" y="4" width="1" height="4" fill="#3B425E" />
          <rect x="11" y="4" width="1" height="4" fill="#3B425E" />
          <rect x="5" y="1" width="6" height="1" fill="#525B80" />
        </>
      )}
      {itemKey === "head_hat_adventurer" && (
        <>
          <rect x="3" y="3" width="10" height="1" fill="#7C4D2B" />
          <rect x="5" y="1" width="6" height="2" fill="#9A6238" />
          <rect x="5" y="2" width="6" height="1" fill="#D97706" />
        </>
      )}
      {itemKey === "head_circlet_brass" && (
        <>
          <rect x="5" y="3" width="6" height="1" fill="#D97706" />
          <rect x="7" y="2" width="2" height="1" fill="#38BDF8" />
        </>
      )}
      {itemKey === "head_crown_star" && (
        <>
          <rect x="5" y="2" width="6" height="1" fill="#FBBF24" />
          <rect x="5" y="1" width="1" height="1" fill="#FDE68A" />
          <rect x="7" y="1" width="2" height="1" fill="#A78BFA" />
          <rect x="10" y="1" width="1" height="1" fill="#FDE68A" />
        </>
      )}
    </svg>
  );
}
