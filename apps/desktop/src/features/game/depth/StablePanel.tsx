import {
  MountLayer,
  PetLayer,
  type PetSpecies,
  type PetVariant,
} from "@/components/avatar/layers/game/pets";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MAX_PET_BOND, PET_SPECIES_LOCALE, PET_VARIANT_LOCALE } from "./depthCatalog";
import { useGameDepthState, useSetActivePetMutation } from "./useGameDepth";

/**
 * Stable tab on `/character` (Game style):
 * Shows unlocked companions, bond progress (0..50), and Companion/Mount toggle at 50.
 */
export function StablePanel() {
  const depthQuery = useGameDepthState();
  const setActivePet = useSetActivePetMutation();

  if (depthQuery.isLoading) {
    return (
      <div
        aria-label={t("game.depth.loading")}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 3 }, (_, idx) => (
          <div
            key={idx}
            className="h-36 animate-pulse rounded-xl border border-border bg-card p-4"
          />
        ))}
      </div>
    );
  }

  if (depthQuery.isError || !depthQuery.data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <span>{t("game.depth.error.load")}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void depthQuery.refetch()}>
          {t("game.depth.error.retry")}
        </Button>
      </div>
    );
  }

  const { pets } = depthQuery.data;

  if (pets.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        {t("game.depth.stable.empty")}
      </div>
    );
  }

  return (
    <section aria-label={t("game.depth.stable.title")} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pets.map((pet) => {
          const speciesKey =
            PET_SPECIES_LOCALE[pet.species_key as PetSpecies] ?? "game.depth.pets.owl";
          const variantKey =
            PET_VARIANT_LOCALE[pet.variant_key as PetVariant] ?? "game.depth.variant.classic";
          const itemKey = `${pet.species_key}:${pet.variant_key}`;
          const bondPct = Math.min(100, Math.max(0, (pet.growth_points / MAX_PET_BOND) * 100));
          const busy = setActivePet.isPending;

          return (
            <article
              key={pet.id}
              className={cn(
                "flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 transition-colors",
                pet.is_active ? "border-primary" : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  dir="ltr"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50"
                >
                  {pet.is_mounted ? (
                    <MountLayer itemKey={itemKey} className="game-pixel-art h-8 w-8" />
                  ) : (
                    <PetLayer itemKey={itemKey} className="game-pixel-art h-8 w-8" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {t(speciesKey)}
                    </h3>
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                      {t(variantKey)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {pet.is_active && (
                      <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
                        {pet.is_mounted
                          ? t("game.depth.stable.mountedBadge")
                          : t("game.depth.stable.activeBadge")}
                      </span>
                    )}
                    {pet.mount_unlocked && (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                        {t("game.depth.stable.mountReady")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="tnum">
                    {t("game.depth.stable.bondProgress", {
                      current: formatNumber(pet.growth_points),
                      max: formatNumber(MAX_PET_BOND),
                    })}
                  </span>
                  {!pet.mount_unlocked && (
                    <span className="text-[11px]">{t("game.depth.stable.mountLocked")}</span>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-label={t(speciesKey)}
                  aria-valuemin={0}
                  aria-valuemax={MAX_PET_BOND}
                  aria-valuenow={pet.growth_points}
                  className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className="h-full rounded-full bg-[hsl(var(--game-xp))]"
                    style={{ width: `${bondPct}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {(!pet.is_active || pet.is_mounted) && (
                  <Button
                    type="button"
                    size="sm"
                    variant={pet.is_active ? "outline" : "default"}
                    disabled={busy}
                    onClick={() => setActivePet.mutate({ petId: pet.id, mounted: false })}
                  >
                    {t("game.depth.stable.equipCompanion")}
                  </Button>
                )}

                {pet.mount_unlocked && !pet.is_mounted && (
                  <Button
                    type="button"
                    size="sm"
                    variant={pet.is_active ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => setActivePet.mutate({ petId: pet.id, mounted: true })}
                  >
                    {t("game.depth.stable.equipMount")}
                  </Button>
                )}

                {pet.is_active && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setActivePet.mutate({ petId: null, mounted: false })}
                  >
                    {t("game.depth.stable.unequip")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
