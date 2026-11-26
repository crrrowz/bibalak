import { StreakView, type StreakViewProps } from "./StreakView";

/**
 * Shared content frame for `/streak` (renders `StreakView`).
 */
export function StreakContent({ showTitle = true }: StreakViewProps = {}) {
  return <StreakView showTitle={showTitle} />;
}
