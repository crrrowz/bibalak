import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProgressDay } from "@bibalak/ipc-types";
import {
  CertificateIcon,
  KnowledgePointsIcon,
  LectureLogIcon,
  LevelIcon,
  TranscriptIcon,
  XpIcon,
} from "@/components/icons/progress";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import {
  formatBackendDate,
  useProgressByDeck,
  useProgressHistory,
  useProgressSummary,
  useStudyDays,
} from "@/features/progress/useProgressSummary";
import { formatNumber, t } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import {
  SCHOLAR_TITLE_TIERS,
  displayCertificateName,
  formatCurrency,
  formatPoints,
  scholarTitle,
} from "@/lib/styles/scholar";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { useStyle } from "@/stores/style";

interface EarnedCertificate {
  index: number;
  titleKey: (typeof SCHOLAR_TITLE_TIERS)[number]["key"];
  date: string;
}

function deriveEarnedCertificates(history: ProgressDay[]): EarnedCertificate[] {
  const earned: EarnedCertificate[] = [];
  for (const tier of SCHOLAR_TITLE_TIERS) {
    if (tier.minLevel < 5) continue;
    const firstDay = history.find((d) => d.level_after >= tier.minLevel);
    if (firstDay) {
      earned.push({
        index: tier.index,
        titleKey: tier.key,
        date: firstDay.date,
      });
    }
  }
  return earned;
}

/** Scholar-style academic Transcript & daily Lecture Log screen (`/transcript`). */
export function TranscriptScreen() {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const navigate = useOptionalNavigate();
  const isScholar = style === "scholar";

  const summaryQuery = useProgressSummary(isScholar);
  const historyQuery = useProgressHistory(isScholar);
  const byDeckQuery = useProgressByDeck(isScholar);
  const studyDaysQuery = useStudyDays(30, isScholar);
  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri && isScholar,
  });

  const deckNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of decksQuery.data ?? []) {
      map.set(d.id, d.name);
    }
    return map;
  }, [decksQuery.data]);

  const earnedCertificates = useMemo(
    () => deriveEarnedCertificates(historyQuery.data ?? []),
    [historyQuery.data],
  );

  const openAppearanceSettings = () => {
    try {
      sessionStorage.setItem("keepsake-settings-category", "general");
    } catch {
      // ignore sessionStorage failures
    }
    navigate?.("/settings");
  };

  const breadcrumb = navigate
    ? {
        label: t("nav.stats"),
        onBack: () => navigate("/stats"),
      }
    : undefined;

  if (!tauri) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title={t("scholar.transcript.title")} />
        <div className="p-6 text-sm text-muted-foreground">
          {t("scholar.transcript.desktopOnly")}
        </div>
      </div>
    );
  }

  if (!isScholar) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title={t("scholar.transcript.title")} breadcrumb={breadcrumb} />
        <div className="mx-auto w-full max-w-3xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-foreground">{t("scholar.transcript.defaultStyleNote")}</p>
            <Button type="button" size="sm" onClick={openAppearanceSettings}>
              {t("scholar.transcript.openAppearance")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isLoading =
    summaryQuery.isLoading ||
    historyQuery.isLoading ||
    byDeckQuery.isLoading ||
    studyDaysQuery.isLoading;

  const hasError =
    summaryQuery.isError || historyQuery.isError || byDeckQuery.isError || studyDaysQuery.isError;

  const retryAll = () => {
    void summaryQuery.refetch();
    void historyQuery.refetch();
    void byDeckQuery.refetch();
    void studyDaysQuery.refetch();
    void decksQuery.refetch();
  };

  const summary = summaryQuery.data;
  const courses = byDeckQuery.data ?? [];
  const studyDays = studyDaysQuery.data ?? [];
  const learnerName = displayCertificateName();

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("scholar.transcript.title")} breadcrumb={breadcrumb} />

      <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {isLoading ? (
            <div
              role="status"
              aria-label={t("scholar.transcript.loading")}
              className="space-y-4 rounded-xl border border-border bg-card p-6"
            >
              <div className="h-5 w-48 rounded bg-muted" />
              <div className="h-4 w-72 rounded bg-muted" />
              <div className="h-28 w-full rounded bg-muted" />
            </div>
          ) : hasError || !summary ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5"
            >
              <p className="text-sm text-foreground">{t("scholar.transcript.error")}</p>
              <Button type="button" size="sm" variant="outline" onClick={retryAll}>
                {t("scholar.transcript.retry")}
              </Button>
            </div>
          ) : (
            <>
              {/* Transcript Header */}
              <header className="rounded-xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-foreground">
                      <bdi>{learnerName}</bdi>
                    </p>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                      <LevelIcon className="size-4 shrink-0" />
                      <span>
                        {t("progress.scholarLevel", {
                          title: t(scholarTitle(summary.level)),
                          level: formatNumber(summary.level),
                        })}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <XpIcon className="size-4 shrink-0 text-primary" />
                      <span className="tnum font-medium text-foreground">
                        {t("progress.totalXp", { xp: formatNumber(summary.total_xp) })}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <KnowledgePointsIcon className="size-4 shrink-0 text-primary" />
                      <span className="tnum font-medium text-foreground">
                        {formatCurrency(summary.gold_cents, "scholar")}
                      </span>
                    </span>
                  </div>
                </div>
              </header>

              {/* Certificates Earned */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="scholar-heading-rule flex items-center gap-2 text-base font-semibold text-foreground">
                  <CertificateIcon className="size-4 shrink-0 text-primary" />
                  <span>{t("scholar.transcript.certificatesTitle")}</span>
                </h2>
                {earnedCertificates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("scholar.transcript.certificatesEmpty")}
                  </p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {earnedCertificates.map((cert) => (
                      <li
                        key={cert.index}
                        className="rounded-lg border-2 border-double border-border bg-background/50 p-3"
                      >
                        <div className="text-sm font-semibold text-primary">{t(cert.titleKey)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatBackendDate(cert.date)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Courses Table */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="scholar-heading-rule flex items-center gap-2 text-base font-semibold text-foreground">
                  <TranscriptIcon className="size-4 shrink-0 text-primary" />
                  <span>{t("scholar.transcript.coursesTitle")}</span>
                </h2>
                {courses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("scholar.transcript.coursesEmpty")}
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-start text-xs text-muted-foreground">
                            <th className="py-2 pe-3 text-start font-medium">
                              {t("scholar.transcript.col.course")}
                            </th>
                            <th className="py-2 pe-3 text-end font-medium">
                              {t("scholar.transcript.col.cards")}
                            </th>
                            <th className="py-2 pe-3 text-end font-medium">
                              {t("scholar.transcript.col.mature")}
                            </th>
                            <th className="py-2 pe-3 text-end font-medium">
                              {t("scholar.transcript.col.retention")}
                            </th>
                            <th className="py-2 pe-3 text-end font-medium">
                              {t("scholar.transcript.col.xp")}
                            </th>
                            <th className="py-2 text-end font-medium">
                              {t("scholar.transcript.col.lastStudied")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {courses.map((course) => (
                            <tr
                              key={course.deck_id}
                              className="border-b border-border/50 last:border-0"
                            >
                              <td className="py-2 pe-3 font-medium text-foreground">
                                {course.name}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {formatNumber(course.total_cards)}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {`${formatNumber(course.mature_pct, { maximumFractionDigits: 0 })}%`}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {`${formatNumber(course.retention_pct, { maximumFractionDigits: 0 })}%`}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {formatNumber(course.xp)}
                              </td>
                              <td className="py-2 text-end text-muted-foreground">
                                {course.last_studied_date
                                  ? formatBackendDate(course.last_studied_date)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("scholar.transcript.coursesNote")}
                    </p>
                  </>
                )}
              </section>

              {/* Lecture Log Section */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="scholar-heading-rule flex items-center gap-2 text-base font-semibold text-foreground">
                  <LectureLogIcon className="size-4 shrink-0 text-primary" />
                  <span>{t("scholar.lectureLog.title")}</span>
                </h2>
                {studyDays.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("scholar.lectureLog.empty")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-start text-xs text-muted-foreground">
                          <th className="py-2 pe-3 text-start font-medium">
                            {t("scholar.lectureLog.col.date")}
                          </th>
                          <th className="py-2 pe-3 text-end font-medium">
                            {t("scholar.lectureLog.col.minutes")}
                          </th>
                          <th className="py-2 pe-3 text-end font-medium">
                            {t("scholar.lectureLog.col.cards")}
                          </th>
                          <th className="py-2 pe-3 text-end font-medium">
                            {t("scholar.lectureLog.col.tasks")}
                          </th>
                          <th className="py-2 pe-3 text-end font-medium">
                            {t("scholar.lectureLog.col.habits")}
                          </th>
                          <th className="py-2 pe-3 text-start font-medium">
                            {t("scholar.lectureLog.col.decks")}
                          </th>
                          <th className="py-2 pe-3 text-end font-medium">
                            {t("scholar.lectureLog.col.xp")}
                          </th>
                          <th className="py-2 text-end font-medium">
                            {t("scholar.lectureLog.col.points")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {studyDays.map((day) => {
                          const names = day.deck_ids
                            .map((id) => deckNames.get(id))
                            .filter((n): n is string => Boolean(n));
                          return (
                            <tr key={day.day} className="border-b border-border/50 last:border-0">
                              <td className="py-2 pe-3 text-foreground">
                                {formatBackendDate(day.date)}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {formatNumber(day.minutes, { maximumFractionDigits: 1 })}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {formatNumber(day.reviews)}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {formatNumber(day.tasks_completed)}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums">
                                {formatNumber(day.habits_completed)}
                              </td>
                              <td className="py-2 pe-3 text-muted-foreground">
                                {names.length > 0 ? names.join(", ") : "—"}
                              </td>
                              <td className="py-2 pe-3 text-end tabular-nums font-medium text-foreground">
                                <bdi dir="ltr">
                                  {t("scholar.transcript.xpValue", { xp: formatNumber(day.xp) })}
                                </bdi>
                              </td>
                              <td className="py-2 text-end tabular-nums text-muted-foreground">
                                <bdi dir="ltr">
                                  {t("scholar.lectureLog.pointsValue", {
                                    points: formatPoints(day.gold_cents),
                                  })}
                                </bdi>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
