import { useEffect, useState, useSyncExternalStore } from "react";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookType,
  Calendar as CalendarIcon,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Moon,
  Play,
  Plus,
  PlusCircle,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Sun,
  Upload,
  Languages,
  Zap,
} from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { ipc, isTauri, pickAndImportPackage, pickAndExportPackage } from "@/lib/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { Kbd } from "@/components/Kbd";
import { t, getLocale, setLocale } from "@/lib/i18n";
import { pluginHost } from "@/lib/pluginHost";

/**
 * Keyboard-first command palette (⌘K / Ctrl+K).
 * Groups: Navigation · Decks · Data · Theme.
 * Plugin commands register against the same list via the extension registry (M9).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { resolved, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const tauri = isTauri();
  const paletteOpenSignal = useUi((s) => s.paletteOpenSignal);
  const pluginCommands = useSyncExternalStore(
    pluginHost.subscribe,
    pluginHost.getSnapshot,
  ).commands;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Signal-based open request from chrome outside this component (e.g. TitleBar).
  useEffect(() => {
    if (paletteOpenSignal > 0) setOpen(true);
  }, [paletteOpenSignal]);

  const close = () => setOpen(false);

  const go = (to: string) => {
    close();
    void navigate({ to });
  };

  const itemClass =
    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground outline-none aria-selected:bg-accent aria-selected:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground";

  const shortcutClass = "ms-auto text-xs text-muted-foreground";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label={t("palette.label")}
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0"
      contentClassName="glass-panel fixed left-1/2 top-[18%] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border text-popover-foreground shadow-2xl data-[state=open]:animate-fade-in"
    >
      <Command.Input
        placeholder={t("palette.placeholder")}
        className="w-full border-b border-border bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          {t("palette.empty")}
        </Command.Empty>

        <Command.Group heading={t("palette.group.navigation")}>
          <Command.Item className={itemClass} onSelect={() => go("/")}>
            <Layers /> {t("shortcuts.goDecks")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/browse")}>
            <Search /> {t("palette.browseCards")}
            <span className={shortcutClass}>
              <Kbd>B</Kbd>
            </span>
          </Command.Item>
          {tauri && (
            <Command.Item className={itemClass} onSelect={() => go("/add")}>
              <PlusCircle /> {t("palette.addNote")}
            </Command.Item>
          )}
          {tauri && (
            <Command.Item className={itemClass} onSelect={() => go("/notetypes")}>
              <BookType /> {t("palette.noteTypes")}
            </Command.Item>
          )}
          <Command.Item className={itemClass} onSelect={() => go("/stats")}>
            <BarChart3 /> {t("palette.statistics")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/assistant")}>
            <Sparkles /> {t("nav.assistant")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/plan/matrix")}>
            <LayoutGrid /> {t("nav.matrix")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/plan/habits")}>
            <CheckCircle2 /> {t("nav.habits")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/plan/calendar")}>
            <CalendarIcon /> {t("nav.calendar")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/media")}>
            <ImageIcon /> {t("nav.media")}
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go("/settings")}>
            <Settings /> {t("nav.settings")}
          </Command.Item>
        </Command.Group>

        {tauri && (
          <Command.Group heading={t("nav.decks")}>
            <Command.Item
              className={itemClass}
              onSelect={async () => {
                close();
                try {
                  const list = await queryClient.ensureQueryData<DeckSummary[]>({
                    queryKey: queryKeys.decks,
                    queryFn: ipc.listDecks,
                  });
                  const next = list.find(
                    (d) => !d.is_filtered && d.new_count + d.learning_count + d.review_count > 0,
                  );
                  if (next) {
                    void navigate({ to: "/study/$deckId", params: { deckId: next.id } });
                  } else {
                    void navigate({ to: "/" });
                  }
                } catch {
                  void navigate({ to: "/" });
                }
              }}
            >
              <Play /> {t("palette.studyNext")}
            </Command.Item>
            <Command.Item
              className={itemClass}
              onSelect={() => {
                close();
                void navigate({ to: "/", search: { create: true } });
              }}
            >
              <Plus /> {t("decks.newDeck")}
            </Command.Item>
            <Command.Item
              className={itemClass}
              onSelect={() => {
                close();
                void ipc.toggleQuickAdd();
              }}
            >
              <Zap /> {t("palette.quickAdd")}
            </Command.Item>
          </Command.Group>
        )}

        {tauri && (
          <Command.Group heading={t("palette.group.data")}>
            <Command.Item
              className={itemClass}
              onSelect={async () => {
                close();
                try {
                  const summary = await pickAndImportPackage();
                  if (summary) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
                  }
                } catch {
                  // errors surfaced in the source screen
                }
              }}
            >
              <Download /> {t("palette.import")}
            </Command.Item>
            <Command.Item
              className={itemClass}
              onSelect={async () => {
                close();
                await pickAndExportPackage();
              }}
            >
              <Upload /> {t("palette.export")}
            </Command.Item>
          </Command.Group>
        )}

        {pluginCommands.length > 0 && (
          <Command.Group heading={t("palette.group.plugins")}>
            {pluginCommands.map((cmd) => (
              <Command.Item
                key={`${cmd.pluginId}::${cmd.id}`}
                className={itemClass}
                onSelect={() => {
                  close();
                  pluginHost.invokeCommand(cmd.pluginId, cmd.id);
                }}
              >
                <Puzzle /> {cmd.title}
                {cmd.keybinding && (
                  <span className={shortcutClass}>
                    <Kbd>{cmd.keybinding}</Kbd>
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading={t("palette.group.appearance")}>
          <Command.Item
            className={itemClass}
            onSelect={() => {
              setTheme(resolved === "dark" ? "light" : "dark");
              close();
            }}
          >
            {resolved === "dark" ? <Sun /> : <Moon />} {t("palette.toggleTheme")}
          </Command.Item>
          <Command.Item
            className={itemClass}
            onSelect={() => {
              close();
              setLocale(getLocale() === "ar" ? "en" : "ar");
            }}
          >
            <Languages /> {t("palette.switchLanguage")}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
