import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function AccessoryLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="accessory"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "acc_monocle_amber" && (
        <>
          <rect x="9" y="5" width="1" height="1" fill="#F59E0B" opacity="0.7" />
          <rect x="10" y="6" width="1" height="2" fill="#D97706" />
        </>
      )}
      {itemKey === "acc_scarf_stripe" && (
        <>
          <rect x="5" y="8" width="6" height="1" fill="#DC2626" />
          <rect x="6" y="8" width="1" height="1" fill="#FEF3C7" />
          <rect x="9" y="8" width="1" height="1" fill="#FEF3C7" />
          <rect x="8" y="9" width="2" height="2" fill="#DC2626" />
        </>
      )}
      {itemKey === "acc_pin_laurel" && (
        <>
          <rect x="9" y="9" width="1" height="1" fill="#22C55E" />
          <rect x="10" y="9" width="1" height="1" fill="#FACC15" />
        </>
      )}
    </svg>
  );
}
