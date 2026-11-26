import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  Bell,
  Database,
  GraduationCap,
  Info,
  PlusCircle,
  Puzzle,
  Sliders,
  Sparkles,
  Volume2,
  Wrench,
} from "lucide-react";
import { StyleDefaultIcon, StyleGameIcon, StyleScholarIcon } from "@/components/icons/progress";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { useStyle, type Style } from "@/stores/style";
import { useSound } from "@/stores/sound";
import {
  SCHOLAR_NAME_MAX_LENGTH,
  readCertificateName,
  writeCertificateName,
} from "@/lib/styles/scholar";
import { useTheme, type Theme } from "@/stores/theme";
import { useWeekStart } from "@/stores/weekStart";
import { ipc, isTauri } from "@/lib/ipc";
import type { WeekStart } from "@bibalak/ipc-types";
import { formatDate, t, useLocale, LOCALE_NAMES, type Locale } from "@/lib/i18n";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeys";
import { queryKeys } from "@/lib/queryKeys";
import type { LocaleKey } from "@/locales/en";
import { QuickAddSection } from "@/components/settings/QuickAddSection";
import { AISection } from "@/components/settings/AISection";
import { DailyGoalSetting } from "@/features/motivation/DailyGoalSetting";
import { BackupSection } from "./BackupSection";
import { MaintenanceSection } from "./MaintenanceSection";
import { NotificationsSection } from "./NotificationsSection";
import { PluginManagerSection } from "./PluginManagerSection";
import { RolloverSection } from "./RolloverSection";
import { UpdateSection } from "./UpdateSection";
import { ExportDialog } from "@/components/importExport/ExportDialog";

export type SettingsCategory =
  | "general"
  | "study"
  | "sound"
  | "notifications"
  | "quickAdd"
  | "ai"
  | "data"
  | "maintenance"
  | "plugins"
  | "updates"
  | "about";

interface CategoryDef {
  id: SettingsCategory;
  labelKey: LocaleKey;
  descKey: LocaleKey;
  helpKey: LocaleKey;
  icon: React.ComponentType<{ className?: string }>;
  desktopOnly?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: "general",
    labelKey: "settings.category.general",
    descKey: "settings.category.generalDesc",
    helpKey: "settings.category.generalHelp",
    icon: Sliders,
  },
  {
    id: "study",
    labelKey: "settings.category.study",
    descKey: "settings.category.studyDesc",
    helpKey: "settings.category.studyHelp",
    icon: GraduationCap,
  },
  {
    id: "sound",
    labelKey: "settings.category.sound",
    descKey: "settings.category.soundDesc",
    helpKey: "settings.category.soundHelp",
    icon: Volume2,
  },
  {
    id: "notifications",
    labelKey: "settings.category.notifications",
    descKey: "settings.category.notificationsDesc",
    helpKey: "settings.category.notificationsHelp",
    icon: Bell,
    desktopOnly: true,
  },
  {
    id: "quickAdd",
    labelKey: "settings.category.quickAdd",
    descKey: "settings.category.quickAddDesc",
    helpKey: "settings.category.quickAddHelp",
    icon: PlusCircle,
    desktopOnly: true,
  },
  {
    id: "ai",
    labelKey: "settings.category.ai",
    descKey: "settings.category.aiDesc",
    helpKey: "settings.category.aiHelp",
    icon: Sparkles,
    desktopOnly: true,
  },
  {
    id: "data",
    labelKey: "settings.category.data",
    descKey: "settings.category.dataDesc",
    helpKey: "settings.category.dataHelp",
    icon: Database,
    desktopOnly: true,
  },
  {
    id: "maintenance",
    labelKey: "settings.category.maintenance",
    descKey: "settings.category.maintenanceDesc",
    helpKey: "settings.category.maintenanceHelp",
    icon: Wrench,
    desktopOnly: true,
  },
  {
    id: "plugins",
    labelKey: "settings.category.plugins",
    descKey: "settings.category.pluginsDesc",
    helpKey: "settings.category.pluginsHelp",
    icon: Puzzle,
    desktopOnly: true,
  },
  {
    id: "updates",
    labelKey: "settings.category.updates",
    descKey: "settings.category.updatesDesc",
    helpKey: "settings.category.updatesHelp",
    icon: ArrowDownCircle,
    desktopOnly: true,
  },
  {
    id: "about",
    labelKey: "settings.category.about",
    descKey: "settings.category.aboutDesc",
    helpKey: "settings.category.aboutHelp",
    icon: Info,
  },
];

const SESSION_CATEGORY_KEY = "keepsake-settings-category";

const themes: { value: Theme; label: LocaleKey }[] = [
  { value: "light", label: "settings.theme.light" },
  { value: "dark", label: "settings.theme.dark" },
  { value: "system", label: "settings.theme.system" },
];
const themeValues = themes.map((o) => o.value);

const presentationStyles: {
  value: Style;
  label: LocaleKey;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "default", label: "settings.style.default", icon: StyleDefaultIcon },
  { value: "scholar", label: "settings.style.scholar", icon: StyleScholarIcon },
  { value: "game", label: "settings.style.game", icon: StyleGameIcon },
];
const styleValues = presentationStyles.map((o) => o.value);
const weekStarts: { value: WeekStart; label: LocaleKey }[] = [
  { value: "sat", label: "settings.appearance.weekStart.sat" },
  { value: "sun", label: "settings.appearance.weekStart.sun" },
  { value: "mon", label: "settings.appearance.weekStart.mon" },
];
const weekStartValues = weekStarts.map((o) => o.value);
const localeOptions = Object.keys(LOCALE_NAMES) as Locale[];

export function SettingsScreen() {
  const { theme, setTheme } = useTheme();
  const { style, setStyle } = useStyle();
  const styleSfxEnabled = useSound((s) => s.styleSfxEnabled);
  const setStyleSfxEnabled = useSound((s) => s.setStyleSfxEnabled);
  const { weekStart, setWeekStart } = useWeekStart();
  const [certName, setCertName] = useState(readCertificateName);
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const tauri = isTauri();
  const [exportOpen, setExportOpen] = useState(false);
  const appInfoQuery = useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: ipc.appInfo,
    enabled: tauri,
  });

  const availableCategories = CATEGORIES.filter((c) => !c.desktopOnly || tauri);
  const validCategoryIds = availableCategories.map((c) => c.id);

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_CATEGORY_KEY);
      if (saved && (validCategoryIds as string[]).includes(saved)) {
        return saved as SettingsCategory;
      }
    } catch {
      // sessionStorage unavailable
    }
    return "general";
  });

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleCategorySelect = (id: SettingsCategory) => {
    setActiveCategory(id);
    try {
      sessionStorage.setItem(SESSION_CATEGORY_KEY, id);
    } catch {
      // sessionStorage unavailable
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = availableCategories.findIndex((c) => c.id === activeCategory);
    if (currentIndex === -1) return;

    let nextIndex = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % availableCategories.length;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + availableCategories.length) % availableCategories.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = availableCategories.length - 1;
    }

    if (nextIndex !== -1) {
      const nextCat = availableCategories[nextIndex];
      handleCategorySelect(nextCat.id);
      tabRefs.current[nextCat.id]?.focus();
    }
  };

  const currentCategoryDef =
    availableCategories.find((c) => c.id === activeCategory) ?? availableCategories[0];

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("settings.title")} description={t("settings.description")} />

      <div className="flex flex-1 flex-col overflow-hidden min-[900px]:flex-row">
        {/* Category Navigation (left column on >=900px, top bar on <900px) */}
        <nav
          role="tablist"
          aria-label={t("settings.categories")}
          onKeyDown={handleKeyDown}
          className="shrink-0 border-b border-border bg-card/40 p-2 min-[900px]:w-64 min-[900px]:border-b-0 min-[900px]:border-e min-[900px]:p-4 overflow-x-auto min-[900px]:overflow-y-auto"
        >
          <div className="flex min-[900px]:flex-col gap-1">
            {availableCategories.map((cat) => {
              const isSelected = activeCategory === cat.id;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  ref={(el) => {
                    tabRefs.current[cat.id] = el;
                  }}
                  role="tab"
                  id={`tab-${cat.id}`}
                  aria-label={t(cat.labelKey)}
                  aria-selected={isSelected}
                  aria-controls={`panel-${cat.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => handleCategorySelect(cat.id)}
                  className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors min-[900px]:whitespace-normal whitespace-nowrap ${
                    isSelected
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block">{t(cat.labelKey)}</span>
                    <span
                      data-testid="settings-tab-help"
                      className="mt-0.5 hidden text-[11px] font-normal leading-snug text-muted-foreground min-[900px]:block"
                    >
                      {t(cat.helpKey)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Selected Category Content Area */}
        <main
          role="tabpanel"
          id={`panel-${currentCategoryDef.id}`}
          aria-labelledby={`tab-${currentCategoryDef.id}`}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8"
        >
          <div className="mx-auto max-w-[44rem] space-y-6">
            {/* Category header */}
            <header className="border-b border-border pb-4">
              <div className="text-xl font-semibold tracking-tight text-foreground">
                {t(currentCategoryDef.labelKey)}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{t(currentCategoryDef.descKey)}</p>
            </header>

            {/* Category Cards */}
            {activeCategory === "general" && (
              <div className="space-y-6">
                <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">
                      {t("settings.appearance.title")}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.appearance.description")}
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {t("settings.theme.label")}
                      </div>
                      <div
                        className="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label={t("settings.theme.label")}
                      >
                        {themes.map((option, idx) => (
                          <Button
                            key={option.value}
                            variant={theme === option.value ? "default" : "outline"}
                            size="sm"
                            role="radio"
                            aria-checked={theme === option.value}
                            tabIndex={theme === option.value ? 0 : -1}
                            onClick={() => setTheme(option.value)}
                            onKeyDown={(e) =>
                              handleRadioGroupKeyDown(e, themeValues, idx, setTheme)
                            }
                          >
                            {t(option.label)}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {t("settings.style.label")}
                      </div>
                      <div
                        className="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label={t("settings.style.label")}
                      >
                        {presentationStyles.map((option, idx) => {
                          const Icon = option.icon;
                          return (
                            <Button
                              key={option.value}
                              variant={style === option.value ? "default" : "outline"}
                              size="sm"
                              role="radio"
                              aria-checked={style === option.value}
                              tabIndex={style === option.value ? 0 : -1}
                              className="gap-1.5"
                              onClick={() => setStyle(option.value)}
                              onKeyDown={(e) =>
                                handleRadioGroupKeyDown(e, styleValues, idx, setStyle)
                              }
                            >
                              <Icon className="size-3.5" />
                              <span>{t(option.label)}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {style === "scholar" && (
                      <div className="pt-1">
                        <label
                          htmlFor="scholar-certificate-name"
                          className="mb-1.5 block text-xs font-medium text-muted-foreground"
                        >
                          {t("scholar.certificate.nameLabel")}
                        </label>
                        <input
                          id="scholar-certificate-name"
                          type="text"
                          maxLength={SCHOLAR_NAME_MAX_LENGTH}
                          value={certName}
                          placeholder={t("scholar.certificate.namePlaceholder")}
                          onChange={(e) => {
                            const raw = e.target.value.slice(0, SCHOLAR_NAME_MAX_LENGTH);
                            setCertName(raw);
                            writeCertificateName(raw);
                          }}
                          onBlur={() => {
                            setCertName(readCertificateName());
                          }}
                          className="h-9 w-full max-w-sm rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("scholar.certificate.nameHint")}
                        </p>
                      </div>
                    )}

                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {t("settings.appearance.weekStart.label")}
                      </div>
                      <div
                        className="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label={t("settings.appearance.weekStart.label")}
                      >
                        {weekStarts.map((option, idx) => (
                          <Button
                            key={option.value}
                            variant={weekStart === option.value ? "default" : "outline"}
                            size="sm"
                            role="radio"
                            aria-checked={weekStart === option.value}
                            tabIndex={weekStart === option.value ? 0 : -1}
                            onClick={() => setWeekStart(option.value)}
                            onKeyDown={(e) =>
                              handleRadioGroupKeyDown(e, weekStartValues, idx, setWeekStart)
                            }
                          >
                            {t(option.label)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">
                      {t("settings.language.title")}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.language.description")}
                    </p>
                  </div>
                  <div
                    className="flex gap-2"
                    role="radiogroup"
                    aria-label={t("settings.language.title")}
                  >
                    {localeOptions.map((option, idx) => (
                      <Button
                        key={option}
                        lang={option}
                        variant={locale === option ? "default" : "outline"}
                        size="sm"
                        role="radio"
                        aria-checked={locale === option}
                        tabIndex={locale === option ? 0 : -1}
                        onClick={() => setLocale(option)}
                        onKeyDown={(e) => handleRadioGroupKeyDown(e, localeOptions, idx, setLocale)}
                      >
                        {LOCALE_NAMES[option]}
                      </Button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeCategory === "sound" && (
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-foreground">
                    {t("settings.sound.title")}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.sound.description")}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span
                      id="settings-style-sfx-label"
                      className="text-sm font-medium text-foreground"
                    >
                      {t("settings.sound.styleSfx")}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.sound.styleSfxHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={styleSfxEnabled}
                    aria-labelledby="settings-style-sfx-label"
                    onClick={() => setStyleSfxEnabled(!styleSfxEnabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      styleSfxEnabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform ${
                        styleSfxEnabled ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  {t("settings.sound.volumesInFooter")}
                </p>
              </section>
            )}

            {activeCategory === "notifications" && tauri && <NotificationsSection />}

            {activeCategory === "study" && (
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-foreground">
                    {t("settings.scheduling.title")}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.scheduling.description")}
                  </p>
                </div>
                {tauri && <RolloverSection />}
                {tauri && <DailyGoalSetting />}
              </section>
            )}

            {activeCategory === "quickAdd" && tauri && <QuickAddSection />}

            {activeCategory === "ai" && tauri && <AISection />}

            {activeCategory === "data" && tauri && (
              <div className="space-y-6">
                <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">
                      {t("settings.export.title")}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.export.description")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                      {t("settings.export.button")}
                    </Button>
                  </div>
                </section>

                <ExportDialog
                  open={exportOpen}
                  scope={{ kind: "collection" }}
                  onClose={() => setExportOpen(false)}
                />

                <BackupSection />
              </div>
            )}

            {activeCategory === "maintenance" && tauri && <MaintenanceSection />}

            {activeCategory === "plugins" && tauri && <PluginManagerSection />}

            {activeCategory === "updates" && tauri && <UpdateSection />}

            {activeCategory === "about" && (
              <div className="space-y-6">
                <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">
                      {t("settings.category.about")}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.category.aboutDesc")}
                    </p>
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <dt className="text-xs text-muted-foreground">
                        {t("settings.about.version")}
                      </dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        {appInfoQuery.data?.version ?? "1.0.0"}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <dt className="text-xs text-muted-foreground">
                        {t("settings.about.tauriVersion")}
                      </dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        {appInfoQuery.data?.tauri_version
                          ? `Tauri ${appInfoQuery.data.tauri_version}`
                          : "Web"}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3 sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">{t("settings.about.build")}</dt>
                      <dd className="mt-0.5 font-mono text-xs text-foreground">
                        {t("settings.updates.buildStamp", {
                          sha: __BUILD_SHA__,
                          date: formatDate(new Date(__BUILD_DATE__), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
                      </dd>
                    </div>
                    {appInfoQuery.data?.media_dir && (
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3 sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          {t("settings.about.mediaDir")}
                        </dt>
                        <dd
                          dir="ltr"
                          className="mt-0.5 break-all font-mono text-xs text-foreground"
                        >
                          {appInfoQuery.data.media_dir}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 space-y-2">
                  <h2 className="text-sm font-medium text-foreground">
                    {t("settings.about.compatTitle")}
                  </h2>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("settings.about.compatBody")}
                  </p>
                </section>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
