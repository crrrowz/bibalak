import type { AvatarProfileDto } from "@bibalak/ipc-types";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { formatNumber, t } from "@/lib/i18n";
import { SCHOLAR_TITLE_TIERS, scholarTitleIndex } from "@/lib/styles/scholar";

export interface ScholarOutfitPreviewProps {
  level: number;
  profile?: AvatarProfileDto | null;
}

/**
 * Scholar regalia card: shows the current academic title outfit and a live
 * preview of the next title's outfit (gown, satchel, cap).
 */
export function ScholarOutfitPreview({ level, profile }: ScholarOutfitPreviewProps) {
  const currentIdx = scholarTitleIndex(level);
  const currentTier = SCHOLAR_TITLE_TIERS[currentIdx] ?? SCHOLAR_TITLE_TIERS[0];
  const nextTier = SCHOLAR_TITLE_TIERS[currentIdx + 1] ?? null;

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
        <AvatarStage
          style="scholar"
          size={64}
          level={level}
          profile={profile}
          className="rounded-lg border border-border"
        />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("scholar.character.currentOutfit")}
          </p>
          <p className="truncate text-sm font-semibold text-foreground">{t(currentTier.key)}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
        {nextTier ? (
          <>
            <AvatarStage
              style="scholar"
              size={64}
              level={nextTier.minLevel}
              profile={profile}
              className="rounded-lg border border-border"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t("scholar.character.nextOutfit")}
              </p>
              <p className="text-sm font-semibold text-foreground">
                {t("scholar.character.nextOutfitMeta", {
                  title: t(nextTier.key),
                  level: formatNumber(nextTier.minLevel),
                })}
              </p>
            </div>
          </>
        ) : (
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("scholar.character.nextOutfit")}
            </p>
            <p className="text-sm font-medium text-foreground">
              {t("scholar.character.maxRankReached")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
