import type { SVGProps } from "react";

export interface LayerProps extends SVGProps<SVGSVGElement> {
  itemKey: string;
}

export function ScholarOutfitLayer({ itemKey, ...props }: LayerProps) {
  const isLecturer = itemKey === "scholar_gown_lecturer";
  const isProfessor = itemKey === "scholar_robe_professor";

  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-layer="outfit"
      data-item={itemKey}
      {...props}
    >
      {/* Academic gown base */}
      <rect x="5" y="8" width="6" height="6" fill="#1F2A3A" />
      <rect x="4" y="8" width="1" height="3" fill="#1F2A3A" />
      <rect x="11" y="8" width="1" height="3" fill="#1F2A3A" />
      {/* Collar */}
      <rect x="7" y="8" width="2" height="1" fill="#F6F1E6" />
      {/* Lecturer+ hood */}
      {(isLecturer || isProfessor) && (
        <>
          <rect x="5" y="8" width="1" height="3" fill="#7A2E3A" />
          <rect x="10" y="8" width="1" height="3" fill="#7A2E3A" />
        </>
      )}
      {/* Professor gold trim */}
      {isProfessor && (
        <>
          <rect x="6" y="9" width="1" height="5" fill="#D4A74A" />
          <rect x="9" y="9" width="1" height="5" fill="#D4A74A" />
          <rect x="4" y="10" width="1" height="1" fill="#D4A74A" />
          <rect x="11" y="10" width="1" height="1" fill="#D4A74A" />
        </>
      )}
    </svg>
  );
}
