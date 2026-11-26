import type { SVGProps } from "react";
import { MOUNT_PIXELS, parsePetItemKey, resolvePetPalette } from "./petPalettes";

export interface MountLayerProps extends SVGProps<SVGSVGElement> {
  /** Encoded as `<species>:<variant>`, e.g. `"owl:classic"`. */
  itemKey: string;
}

/**
 * In-house 16×16 SVG pixel mount layer (saddled pose). Never mirrored in RTL (`dir="ltr"`).
 */
export function MountLayer({ itemKey, style, ...props }: MountLayerProps) {
  const { species, variant } = parsePetItemKey(itemKey);
  const palette = resolvePetPalette(species, variant);
  const pixels = MOUNT_PIXELS[species];

  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      direction="ltr"
      aria-hidden="true"
      data-layer="mount"
      data-item={`${species}:${variant}`}
      data-species={species}
      data-variant={variant}
      style={{ direction: "ltr", ...style }}
      {...props}
    >
      {pixels.map(([x, y, w, h, role], idx) => (
        <rect key={idx} x={x} y={y} width={w} height={h} fill={palette[role]} />
      ))}
    </svg>
  );
}
