import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  Bell,
  Copy,
  Database,
  FolderOpen,
  GraduationCap,
  Info,
  PlusCircle,
  Puzzle,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  Volume2,
  Wrench,
} from "lucide-react";
import { StyleDefaultIcon, StyleGameIcon, StyleScholarIcon } from "@/components/icons/progress";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import {
  SettingsCard,
  SettingsSectionHeader,
  SettingsToggleRow,
} from "@/components/ui/settings-kit";
import { useStyle, type Style } from "@/stores/style";
import { useSound } from "@/stores/sound";
import {
  SCHOLAR_NAME_MAX_LENGTH,
  readCertificateName,
  writeCertificateName,
} from "@/lib/styles/scholar";
import { useTheme, type Theme } from "@/stores/theme";
import { defaultWeekStartForLocale, useWeekStart } from "@/stores/weekStart";
import { useReminders } from "@/stores/reminders";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import type { WeekStart } from "@bibalak/ipc-types";
import { formatDate, t, useLocale, LOCALE_NAMES, type Locale } from "@/lib/i18n";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeys";
import { queryKeys } from "@/lib/queryKeys";
import type { LocaleKey } from "@/locales/en";
import { deriveDataDir } from "./settingsUtils";
import { QuickAddSection } from "./QuickAddSection";
import { AISection } from "./AISection";
import { DailyGoalSetting } from "@/features/motivation/DailyGoalSetting";
import { BackupSection } from "./BackupSection";
import { MaintenanceSection } from "./MaintenanceSection";
import { NotificationsSection } from "./NotificationsSection";
import { PluginManagerSection } from "./PluginManagerSection";
import { RolloverSection } from "./RolloverSection";
import { UpdateSection } from "./UpdateSection";
import { useUpdateCheck } from "./updateCheck";
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
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  desktopOnly?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: "general",
    labelKey: "settings.category.general",
    descKey: "settings.category.generalDesc",
    helpKey: "settings.category.generalHelp",
    keywords:
      "theme dark light system style scholar game language arabic english week start reset السمة المظهر اللغة أسلوب",
    icon: Sliders,
  },
  {
    id: "study",
    labelKey: "settings.category.study",
    descKey: "settings.category.studyDesc",
    helpKey: "settings.category.studyHelp",
    keywords: "rollover day goal xp scheduling fsrs sm2 اليوم الهدف التراكمي الجدولة",
    icon: GraduationCap,
  },
  {
    id: "sound",
    labelKey: "settings.category.sound",
    descKey: "settings.category.soundDesc",
    helpKey: "settings.category.soundHelp",
    keywords: "audio sound effects volume mute sfx الصوت المؤثرات",
    icon: Volume2,
  },
  {
    id: "notifications",
    labelKey: "settings.category.notifications",
    descKey: "settings.category.notificationsDesc",
    helpKey: "settings.category.notificationsHelp",
    keywords: "reminders notifications daily streak habits التذكيرات الإشعارات",
    icon: Bell,
    desktopOnly: true,
  },
  {
    id: "quickAdd",
    labelKey: "settings.category.quickAdd",
    descKey: "settings.category.quickAddDesc",
    helpKey: "settings.category.quickAddHelp",
    keywords: "quick add shortcut hotkey window الإضافة السريعة اختصار",
    icon: PlusCircle,
    desktopOnly: true,
  },
  {
    id: "ai",
    labelKey: "settings.category.ai",
    descKey: "settings.category.aiDesc",
    helpKey: "settings.category.aiHelp",
    keywords: "ai assistant ollama openai key model الذكاء المساعد",
    icon: Sparkles,
    desktopOnly: true,
  },
  {
    id: "data",
    labelKey: "settings.category.data",
    descKey: "settings.category.dataDesc",
    helpKey: "settings.category.dataHelp",
    keywords: "backup restore export apkg colpkg النسخ الاحتياطي التصدير استعادة",
    icon: Database,
    desktopOnly: true,
  },
  {
    id: "maintenance",
    labelKey: "settings.category.maintenance",
    descKey: "settings.category.maintenanceDesc",
    helpKey: "settings.category.maintenanceHelp",
    keywords: "integrity optimize media orphan database الصيانة الفحص الوسائط",
    icon: Wrench,
    desktopOnly: true,
  },
  {
    id: "plugins",
    labelKey: "settings.category.plugins",
    descKey: "settings.category.pluginsDesc",
    helpKey: "settings.category.pluginsHelp",
    keywords: "plugins extensions zip permissions الإضافات",
    icon: Puzzle,
    desktopOnly: true,
  },
  {
    id: "updates",
    labelKey: "settings.category.updates",
    descKey: "settings.category.updatesDesc",
    helpKey: "settings.category.updatesHelp",
    keywords: "updates version release check التحديثات الإصدار",
    icon: ArrowDownCircle,
    desktopOnly: true,
  },
  {
    id: "about",
    labelKey: "settings.category.about",
    descKey: "settings.category.aboutDesc",
    helpKey: "settings.category.aboutHelp",
    keywords: "about portable installed folder data media version license حول محمولة مسار",
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
  const [searchQuery, setSearchQuery] = useState("");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [copiedFolder, setCopiedFolder] = useState<"data" | "media" | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const appInfoQuery = useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: ipc.appInfo,
    enabled: tauri,
  });
  const portableQuery = useQuery({
    queryKey: queryKeys.isPortable,
    queryFn: () => platform.updater.isPortable(),
    enabled: tauri,
    staleTime: Infinity,
  });
  const dataDir = appInfoQuery.data?.media_dir ? deriveDataDir(appInfoQuery.data.media_dir) : "";

  async function handleCopyFolder(kind: "data" | "media", path: string) {
    try {
      await navigator.clipboard?.writeText(path);
      setCopiedFolder(kind);
      setFolderError(null);
      window.setTimeout(() => {
        setCopiedFolder((cur) => (cur === kind ? null : cur));
      }, 2000);
    } catch (e) {
      setFolderError(errorMessage(e));
    }
  }

  async function handleOpenFolder(path: string) {
    setFolderError(null);
    try {
      await platform.openPath?.(path);
    } catch (e) {
      setFolderError(errorMessage(e) || t("settings.about.openFailed"));
    }
  }

  const baseCategories = CATEGORIES.filter((c) => !c.desktopOnly || tauri);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const availableCategories = normalizedSearch
    ? baseCategories.filter((c) => {
        const haystack = [t(c.labelKey), t(c.descKey), t(c.helpKey), c.keywords]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : baseCategories;
  const validCategoryIds = baseCategories.map((c) => c.id);

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

  function handleResetPreferences() {
    setTheme("system");
    setStyle("game");
    setCertName("");
    writeCertificateName("");
    setWeekStart(defaultWeekStartForLocale(locale));
    const sound = useSound.getState();
    sound.setCardVolume(100);
    sound.setCardMuted(false);
    sound.setAppVolume(100);
    sound.setAppMuted(false);
    sound.setStyleSfxEnabled(true);
    useReminders.getState().reset();
    useUpdateCheck.getState().setAutoCheck(true);
    setResetConfirmOpen(false);
    setResetMessage(t("settings.reset.done"));
  }

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
    const currentIndex = availableCategories.findIndex((c) => c.id === effectiveCategory);
    if (currentIndex === -1) return;

    const isRtl = locale === "ar";
    const advanceArrow = isRtl ? "ArrowLeft" : "ArrowRight";
    const retreatArrow = isRtl ? "ArrowRight" : "ArrowLeft";

    let nextIndex = -1;
    if (e.key === "ArrowDown" || e.key === advanceArrow) {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % availableCategories.length;
    } else if (e.key === "ArrowUp" || e.key === retreatArrow) {
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
  const effectiveCategory = currentCategoryDef?.id ?? activeCategory;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("settings.title")} description={t("settings.description")} />

      <div className="flex flex-1 flex-col overflow-hidden min-[900px]:flex-row">
        {/* Category Navigation (left column on >=900px, top bar on <900px) */}
        <aside className="shrink-0 border-b border-border bg-card/40 p-2 min-[900px]:w-64 min-[900px]:border-b-0 min-[900px]:border-e min-[900px]:p-4 flex flex-col gap-2 overflow-hidden">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 start-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t("settings.search.label")}
              placeholder={t("settings.search.placeholder")}
              className="h-8 w-full rounded-lg border border-input bg-background ps-8 pe-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <nav
            role="tablist"
            aria-label={t("settings.categories")}
            onKeyDown={handleKeyDown}
            className="overflow-x-auto min-[900px]:overflow-y-auto"
          >
            <div className="flex min-[900px]:flex-col gap-1">
              {availableCategories.map((cat) => {
                const isSelected = effectiveCategory === cat.id;
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
        </aside>

        {/* Selected Category Content Area */}
        <main
          role="tabpanel"
          id={currentCategoryDef ? `panel-${currentCategoryDef.id}` : "panel-empty"}
          aria-labelledby={currentCategoryDef ? `tab-${currentCategoryDef.id}` : undefined}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8"
        >
          {!currentCategoryDef ? (
            <div className="mx-auto max-w-[44rem] py-12 text-center text-sm text-muted-foreground">
              {t("settings.search.empty")}
            </div>
          ) : (
            <div className="mx-auto max-w-[44rem] space-y-6">
              {/* Category header */}
              <header className="border-b border-border pb-4">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {t(currentCategoryDef.labelKey)}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {t(currentCategoryDef.descKey)}
                </p>
              </header>

              {/* Category Cards */}
              {effectiveCategory === "general" && (
                <div className="space-y-6">
                  <SettingsCard>
                    <SettingsSectionHeader
                      title={t("settings.appearance.title")}
                      description={t("settings.appearance.description")}
                    />
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
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {t("settings.sound.styleSfxNote")}
                        </p>
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
                  </SettingsCard>

                  <SettingsCard>
                    <SettingsSectionHeader
                      title={t("settings.language.title")}
                      description={t("settings.language.description")}
                    />
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
                          onKeyDown={(e) =>
                            handleRadioGroupKeyDown(e, localeOptions, idx, setLocale)
                          }
                        >
                          {LOCALE_NAMES[option]}
                        </Button>
                      ))}
                    </div>
                  </SettingsCard>

                  <SettingsCard>
                    <SettingsSectionHeader
                      title={t("settings.reset.title")}
                      description={t("settings.reset.description")}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setResetConfirmOpen(true)}
                      >
                        <RotateCcw className="size-3.5 me-1.5" aria-hidden />
                        {t("settings.reset.button")}
                      </Button>
                      {resetMessage && (
                        <span className="text-xs text-muted-foreground" aria-live="polite">
                          {resetMessage}
                        </span>
                      )}
                    </div>
                    <ConfirmDialog
                      open={resetConfirmOpen}
                      title={t("settings.reset.confirmTitle")}
                      description={t("settings.reset.confirmBody")}
                      confirmLabel={t("settings.reset.button")}
                      onConfirm={handleResetPreferences}
                      onCancel={() => setResetConfirmOpen(false)}
                    />
                  </SettingsCard>
                </div>
              )}

              {effectiveCategory === "sound" && (
                <SettingsCard>
                  <SettingsSectionHeader
                    title={t("settings.sound.cardTitle")}
                    description={t("settings.sound.description")}
                  />
                  <SettingsToggleRow
                    id="settings-style-sfx"
                    label={t("settings.sound.styleSfx")}
                    hint={t("settings.sound.styleSfxHint")}
                    checked={styleSfxEnabled}
                    onToggle={setStyleSfxEnabled}
                  />
                  <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    {t("settings.sound.volumesInFooter")}
                  </p>
                </SettingsCard>
              )}

              {effectiveCategory === "notifications" && tauri && <NotificationsSection />}

              {effectiveCategory === "study" && (
                <SettingsCard>
                  <SettingsSectionHeader
                    title={t("settings.scheduling.title")}
                    description={t("settings.scheduling.description")}
                  />
                  {tauri && <RolloverSection />}
                  {tauri && <DailyGoalSetting />}
                </SettingsCard>
              )}

              {effectiveCategory === "quickAdd" && tauri && <QuickAddSection />}

              {effectiveCategory === "ai" && tauri && <AISection />}

              {effectiveCategory === "data" && tauri && (
                <div className="space-y-6">
                  <SettingsCard>
                    <SettingsSectionHeader
                      title={t("settings.export.title")}
                      description={t("settings.export.description")}
                    />
                    <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                        {t("settings.export.button")}
                      </Button>
                    </div>
                  </SettingsCard>

                  <ExportDialog
                    open={exportOpen}
                    scope={{ kind: "collection" }}
                    onClose={() => setExportOpen(false)}
                  />

                  <BackupSection />
                </div>
              )}

              {effectiveCategory === "maintenance" && tauri && <MaintenanceSection />}

              {effectiveCategory === "plugins" && tauri && <PluginManagerSection />}

              {effectiveCategory === "updates" && tauri && <UpdateSection />}

              {effectiveCategory === "about" && (
                <div className="space-y-6">
                  <SettingsCard>
                    <SettingsSectionHeader title={t("settings.about.appDetails")} />
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                        <dt className="text-xs text-muted-foreground">
                          {t("settings.about.version")}
                        </dt>
                        <dd className="mt-0.5 font-mono text-foreground">
                          <bdi dir="ltr">{appInfoQuery.data?.version ?? __APP_VERSION__}</bdi>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                        <dt className="text-xs text-muted-foreground">
                          {t("settings.about.tauriVersion")}
                        </dt>
                        <dd className="mt-0.5 font-mono text-foreground">
                          {appInfoQuery.data?.tauri_version ? (
                            <bdi dir="ltr">{`Tauri ${appInfoQuery.data.tauri_version}`}</bdi>
                          ) : (
                            t("settings.about.webRuntime")
                          )}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3 sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          {t("settings.about.build")}
                        </dt>
                        <dd className="mt-0.5 font-mono text-xs text-foreground">
                          {t("settings.updates.buildLabel")} <bdi dir="ltr">{__BUILD_SHA__}</bdi> ·{" "}
                          <bdi>
                            {formatDate(new Date(__BUILD_DATE__), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </bdi>
                        </dd>
                      </div>
                      {tauri && portableQuery.data !== undefined && (
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3 sm:col-span-2 flex items-center justify-between gap-2">
                          <dt className="text-xs text-muted-foreground">
                            {t("settings.about.installMode")}
                          </dt>
                          <dd>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                portableQuery.data
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                  : "bg-primary/10 text-primary"
                              }`}
                            >
                              {portableQuery.data
                                ? t("settings.about.modePortable")
                                : t("settings.about.modeInstalled")}
                            </span>
                          </dd>
                        </div>
                      )}
                      {dataDir && (
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3 sm:col-span-2 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <dt className="text-xs text-muted-foreground">
                              {t("settings.about.dataDir")}
                            </dt>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => void handleCopyFolder("data", dataDir)}
                              >
                                <Copy className="size-3" aria-hidden />
                                {copiedFolder === "data"
                                  ? t("settings.about.copied")
                                  : t("settings.about.copyPath")}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => void handleOpenFolder(dataDir)}
                              >
                                <FolderOpen className="size-3" aria-hidden />
                                {t("settings.about.openFolder")}
                              </Button>
                            </div>
                          </div>
                          <dd className="break-all font-mono text-xs text-foreground">
                            <bdi dir="ltr">{dataDir}</bdi>
                          </dd>
                        </div>
                      )}
                      {appInfoQuery.data?.media_dir && (
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3 sm:col-span-2 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <dt className="text-xs text-muted-foreground">
                              {t("settings.about.mediaDir")}
                            </dt>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() =>
                                  void handleCopyFolder("media", appInfoQuery.data!.media_dir)
                                }
                              >
                                <Copy className="size-3" aria-hidden />
                                {copiedFolder === "media"
                                  ? t("settings.about.copied")
                                  : t("settings.about.copyPath")}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => void handleOpenFolder(appInfoQuery.data!.media_dir)}
                              >
                                <FolderOpen className="size-3" aria-hidden />
                                {t("settings.about.openFolder")}
                              </Button>
                            </div>
                          </div>
                          <dd className="break-all font-mono text-xs text-foreground">
                            <bdi dir="ltr">{appInfoQuery.data.media_dir}</bdi>
                          </dd>
                        </div>
                      )}
                    </dl>
                    {folderError && (
                      <p role="alert" className="text-xs text-destructive">
                        {folderError}
                      </p>
                    )}
                  </SettingsCard>

                  <SettingsCard className="space-y-2">
                    <SettingsSectionHeader title={t("settings.about.compatTitle")} />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("settings.about.compatBodyPrefix")}{" "}
                      <bdi dir="ltr" className="font-mono">
                        {"THIRD_PARTY_NOTICES.md"}
                      </bdi>
                      .
                    </p>
                  </SettingsCard>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
