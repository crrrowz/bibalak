import { t } from "@/lib/i18n";
import type { Style } from "@/stores/style";
import { GameEmptyIllustration, type EmptyStateScene } from "./GameEmptyIllustrations";
import { ScholarEmptyIllustration } from "./ScholarEmptyIllustrations";

export type { EmptyStateScene };

interface EmptyStatePictureProps {
  scene: EmptyStateScene;
  style: Style;
}

/**
 * In-house SVG empty-state illustration for Game and Scholar styles.
 * Returns null in Default style so Default keeps its calm icon baseline.
 */
export function EmptyStatePicture({ scene, style }: EmptyStatePictureProps) {
  if (style === "default") return null;

  const label = t(`emptyState.${scene}.${style}`);
  const testId = `empty-illustration-${scene}-${style}`;

  if (style === "game") {
    return <GameEmptyIllustration scene={scene} testId={testId} label={label} />;
  }

  return <ScholarEmptyIllustration scene={scene} testId={testId} label={label} />;
}
