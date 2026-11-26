import { useEffect, useState } from "react";
import type { AvatarProfileDto } from "@bibalak/ipc-types";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { Logo } from "@/components/Logo";
import { CertificateIcon } from "@/components/icons/progress";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import {
  SCHOLAR_TITLE_SEEN_KEY,
  displayCertificateName,
  scholarTitleByIndex,
  scholarTitleIndex,
} from "@/lib/styles/scholar";
import { useStyle } from "@/stores/style";
import { useProgressSummary } from "./useProgressSummary";

export interface CertificateDialogProps {
  open: boolean;
  titleIndex: number;
  level: number;
  totalXp: number;
  date?: Date;
  avatar?: AvatarProfileDto | null;
  onClose: () => void;
}

/**
 * Academic promotion certificate shown once per newly reached Scholar title.
 * Thin double border, Bibalak mark, Scholar avatar, fade-only transition honoring reduced motion.
 */
export function CertificateDialog({
  open,
  titleIndex,
  level,
  totalXp,
  date,
  avatar,
  onClose,
}: CertificateDialogProps) {
  const title = t(scholarTitleByIndex(titleIndex));
  const learnerName = displayCertificateName();
  const formattedDate = formatDate(date ?? new Date(), { dateStyle: "medium" });
  const levelAndXp = t("scholar.certificate.levelAndXp", {
    level: formatNumber(level),
    xp: formatNumber(totalXp),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabelledBy="scholar-certificate-title"
      animation="fade"
      className="max-w-lg p-3 shadow-none"
    >
      <div className="rounded-lg border-4 border-double border-primary/50 bg-card px-7 py-7 text-center">
        <div className="mb-4 flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <Logo size={32} showWordmark={false} />
            <AvatarStage
              style="scholar"
              size={64}
              level={level}
              profile={avatar}
              className="rounded-lg border border-border"
            />
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <CertificateIcon className="size-4 text-primary" />
            <span>{t("scholar.certificate.heading")}</span>
          </div>
        </div>

        <h2
          id="scholar-certificate-title"
          className="text-2xl font-semibold tracking-tight text-primary"
        >
          {title}
        </h2>

        <p className="mt-4 text-xs text-muted-foreground">{t("scholar.certificate.presentedTo")}</p>
        <p className="mt-1 text-lg font-semibold text-foreground">
          <bdi>{learnerName}</bdi>
        </p>

        <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground space-y-1">
          <p className="tnum text-foreground">{levelAndXp}</p>
          <p>{t("scholar.certificate.awardedOn", { date: formattedDate })}</p>
        </div>

        <div className="mt-6 flex justify-center">
          <Button type="button" onClick={onClose}>
            {t("scholar.certificate.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface PendingCertificate {
  titleIndex: number;
  level: number;
  totalXp: number;
  date: Date;
}

function readSeenTitleIndex(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCHOLAR_TITLE_SEEN_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeSeenTitleIndex(index: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, String(index));
  } catch {
    // ignore storage failures
  }
}

/**
 * App-level watcher that updates the title high-water mark in every style
 * and opens CertificateDialog once when a higher title is reached in Scholar.
 */
export function CertificateWatcher() {
  const style = useStyle((s) => s.style);
  const { data } = useProgressSummary();
  const [pending, setPending] = useState<PendingCertificate | null>(null);

  useEffect(() => {
    if (!data) return;
    const currentIdx = scholarTitleIndex(data.level);
    const seenIdx = readSeenTitleIndex();

    if (seenIdx === null) {
      // First-run rule: initialize silently without showing a retroactive certificate.
      writeSeenTitleIndex(currentIdx);
      return;
    }

    if (currentIdx > seenIdx) {
      writeSeenTitleIndex(currentIdx);
      if (style === "scholar") {
        setPending({
          titleIndex: currentIdx,
          level: data.level,
          totalXp: data.total_xp,
          date: new Date(),
        });
      }
    }
  }, [data, style]);

  return (
    <CertificateDialog
      open={pending !== null}
      titleIndex={pending?.titleIndex ?? 0}
      level={pending?.level ?? 1}
      totalXp={pending?.totalXp ?? 0}
      date={pending?.date}
      onClose={() => setPending(null)}
    />
  );
}
