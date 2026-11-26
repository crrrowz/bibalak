import type { SVGProps } from "react";
import { COMPANION_PIXELS, parsePetItemKey, resolvePetPalette } from "./petPalettes";

export interface PetLayerProps extends SVGProps<SVGSVGElement> {
  /** Encoded as `<species>:<variant>`, e.g. `"owl:classic"`. */
  itemKey: string;
}

/**
 * In-house 16×16 SVG pixel companion layer. Never mirrored in RTL (`dir="ltr"`).
 */
export function PetLayer({ itemKey, style, ...props }: PetLayerProps) {
  const { species, variant } = parsePetItemKey(itemKey);
  const palette = resolvePetPalette(species, variant);
  const pixels = COMPANION_PIXELS[species];

  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      direction="ltr"
      aria-hidden="true"
      data-layer="pet"
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
