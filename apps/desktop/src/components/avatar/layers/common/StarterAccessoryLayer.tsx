import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function StarterAccessoryLayer({ itemKey, ...props }: LayerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="accessory"
      data-item={itemKey}
      {...props}
    >
      {itemKey === "acc_glasses" && (
        <>
          <rect x="5" y="5" width="2" height="1" fill="#E2E8F0" opacity="0.65" />
          <rect x="9" y="5" width="2" height="1" fill="#E2E8F0" opacity="0.65" />
          <rect x="7" y="5" width="2" height="1" fill="#94A3B8" />
        </>
      )}
      {itemKey === "acc_headband" && <rect x="5" y="3" width="6" height="1" fill="#C0392B" />}
      {itemKey === "acc_kerchief" && (
        <>
          <rect x="5" y="8" width="6" height="1" fill="#D97706" />
          <rect x="7" y="9" width="2" height="1" fill="#B45309" />
        </>
      )}
    </svg>
  );
}
