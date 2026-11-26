import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function MainHandLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="main_hand"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "hand_wand_oak" && (
        <>
          <rect x="12" y="7" width="1" height="4" fill="#8B5A2B" />
          <rect x="12" y="6" width="1" height="1" fill="#A78BFA" />
        </>
      )}
      {itemKey === "hand_compass_brass" && (
        <>
          <rect x="12" y="8" width="2" height="2" fill="#D97706" />
          <rect x="12" y="9" width="1" height="1" fill="#38BDF8" />
        </>
      )}
      {itemKey === "hand_staff_quill" && (
        <>
          <rect x="12" y="4" width="1" height="10" fill="#78350F" />
          <rect x="12" y="2" width="2" height="2" fill="#FDE68A" />
          <rect x="13" y="1" width="1" height="1" fill="#FFFFFF" />
        </>
      )}
      {itemKey === "hand_sabre_guild" && (
        <>
          <rect x="12" y="5" width="1" height="5" fill="#CBD5E1" />
          <rect x="11" y="10" width="3" height="1" fill="#D4A74A" />
          <rect x="12" y="11" width="1" height="1" fill="#78350F" />
        </>
      )}
    </svg>
  );
}
