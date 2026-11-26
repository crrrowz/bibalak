import type { PluginDeckDto, PluginInfo, PluginNoteDto } from "@bibalak/ipc-types";
import { mockDecks } from "./decks";
import { mockNoteDetails } from "./notes";
import focusTimerManifest from "../../../../../examples/plugins/focus-timer/plugin.json";
import focusTimerEntry from "../../../../../examples/plugins/focus-timer/index.js?raw";
import todayGlanceManifest from "../../../../../examples/plugins/today-at-a-glance/plugin.json";
import todayGlanceEntry from "../../../../../examples/plugins/today-at-a-glance/index.js?raw";
import leechHelperManifest from "../../../../../examples/plugins/leech-helper/plugin.json";
import leechHelperEntry from "../../../../../examples/plugins/leech-helper/index.js?raw";
import noteCheckerManifest from "../../../../../examples/plugins/note-checker/plugin.json";
import noteCheckerEntry from "../../../../../examples/plugins/note-checker/index.js?raw";

interface PreviewPluginEntry {
  info: PluginInfo;
  entry: string;
}

const BUNDLED_PREVIEW_SAMPLES: PreviewPluginEntry[] = [
  {
    info: {
      id: focusTimerManifest.id,
      name: focusTimerManifest.name,
      version: focusTimerManifest.version,
      api_version: focusTimerManifest.apiVersion,
      description: focusTimerManifest.description,
      author: focusTimerManifest.author,
      permissions: [...focusTimerManifest.permissions],
      enabled: false,
    },
    entry: focusTimerEntry,
  },
  {
    info: {
      id: todayGlanceManifest.id,
      name: todayGlanceManifest.name,
      version: todayGlanceManifest.version,
      api_version: todayGlanceManifest.apiVersion,
      description: todayGlanceManifest.description,
      author: todayGlanceManifest.author,
      permissions: [...todayGlanceManifest.permissions],
      enabled: false,
    },
    entry: todayGlanceEntry,
  },
  {
    info: {
      id: leechHelperManifest.id,
      name: leechHelperManifest.name,
      version: leechHelperManifest.version,
      api_version: leechHelperManifest.apiVersion,
      description: leechHelperManifest.description,
      author: leechHelperManifest.author,
      permissions: [...leechHelperManifest.permissions],
      enabled: false,
    },
    entry: leechHelperEntry,
  },
  {
    info: {
      id: noteCheckerManifest.id,
      name: noteCheckerManifest.name,
      version: noteCheckerManifest.version,
      api_version: noteCheckerManifest.apiVersion,
      description: noteCheckerManifest.description,
      author: noteCheckerManifest.author,
      permissions: [...noteCheckerManifest.permissions],
      enabled: false,
    },
    entry: noteCheckerEntry,
  },
];

let previewPlugins: PreviewPluginEntry[] = BUNDLED_PREVIEW_SAMPLES.map((p) => ({
  info: { ...p.info },
  entry: p.entry,
}));

const PREVIEW_EXTRA_NOTES: PluginNoteDto[] = [
  {
    note_id: 901,
    deck: "Medicine::Cardiology",
    notetype: "Basic",
    sort_field: "Warfarin mechanism and CYP2C9 interactions",
    tags: ["leech", "pharmacology"],
    fields: [
      { name: "Front", text: "Warfarin mechanism and CYP2C9 interactions" },
      { name: "Back", text: "Inhibits VKORC1 (vitamin K epoxide reductase)" },
    ],
    media_refs: [],
  },
  {
    note_id: 902,
    deck: "Spanish",
    notetype: "Basic",
    sort_field: "El subjuntivo con expresiones de duda",
    tags: ["spanish", "grammar"],
    fields: [
      { name: "Front", text: "El subjuntivo con expresiones de duda" },
      { name: "Back", text: "" },
    ],
    media_refs: ["missing-audio.mp3"],
  },
];

export const pluginMocks: Record<string, (args: unknown) => unknown> = {
  list_plugins: () => previewPlugins.map((p) => ({ ...p.info })),
  enable_plugin: (args: unknown) => {
    const id = (args as { id?: string } | undefined)?.id;
    const found = previewPlugins.find((p) => p.info.id === id);
    if (!found) throw { kind: "not-found", message: `plugin not found: ${id}` };
    found.info.enabled = true;
    return null;
  },
  disable_plugin: (args: unknown) => {
    const id = (args as { id?: string } | undefined)?.id;
    const found = previewPlugins.find((p) => p.info.id === id);
    if (found) found.info.enabled = false;
    return null;
  },
  remove_plugin: (args: unknown) => {
    const id = (args as { id?: string } | undefined)?.id;
    previewPlugins = previewPlugins.filter((p) => p.info.id !== id);
    return null;
  },
  install_sample_plugins: () => {
    for (const sample of BUNDLED_PREVIEW_SAMPLES) {
      if (!previewPlugins.some((p) => p.info.id === sample.info.id)) {
        previewPlugins.push({ info: { ...sample.info }, entry: sample.entry });
      }
    }
    return previewPlugins.map((p) => ({ ...p.info }));
  },
  install_plugin: (args: unknown) => {
    const path = (args as { path?: string } | undefined)?.path ?? "custom-plugin";
    const info: PluginInfo = {
      id: "preview-custom-plugin",
      name: path.split(/[/\\]/).pop() || "Custom Plugin",
      version: "1.0.0",
      api_version: "0.2.0",
      description: "Installed from folder in preview mode.",
      author: "Preview",
      permissions: ["ui:command"],
      enabled: false,
    };
    const entry = `BibalakPlugin.definePlugin({ activate(ctx) { ctx.registerCommand({ id: "hello", title: "${info.name}: Hello", run() { ctx.showToast("Hello from ${info.name}"); } }); } });`;
    previewPlugins = [...previewPlugins.filter((p) => p.info.id !== info.id), { info, entry }];
    return { ...info };
  },
  install_plugin_zip: (args: unknown) => pluginMocks.install_plugin(args),
  get_plugin_entry: (args: unknown) => {
    const id = (args as { id?: string } | undefined)?.id;
    const found = previewPlugins.find((p) => p.info.id === id);
    if (!found) throw { kind: "not-found", message: `plugin not found: ${id}` };
    return found.entry;
  },
  plugin_read_decks: (): PluginDeckDto[] =>
    mockDecks.map((d) => ({
      id: d.id,
      name: d.name,
      parent_id: d.parent_id,
      new_count: d.new_count,
      learning_count: d.learning_count,
      review_count: d.review_count,
      due_today: d.new_count + d.learning_count + d.review_count,
      is_filtered: d.is_filtered,
    })),
  plugin_read_notes: (args: unknown): PluginNoteDto[] => {
    const { query = "", limit = 50 } = (args ?? {}) as { query?: string; limit?: number };
    const allNotes: PluginNoteDto[] = [
      ...PREVIEW_EXTRA_NOTES,
      ...Object.values(mockNoteDetails).map((n) => ({
        note_id: n.note_id,
        deck: "Medicine",
        notetype: n.notetype_name,
        sort_field: n.fields[0]?.value ?? "",
        tags: n.tags,
        fields: n.fields.map((f) => ({ name: f.name, text: f.value })),
        media_refs: [],
      })),
    ];
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? allNotes
      : allNotes.filter((n) => {
          if (q.startsWith("tag:")) {
            const needle = q.slice(4);
            return n.tags.some((t) => t.toLowerCase() === needle);
          }
          return (
            n.sort_field.toLowerCase().includes(q) ||
            n.fields.some((f) => f.text.toLowerCase().includes(q)) ||
            n.tags.some((t) => t.toLowerCase().includes(q))
          );
        });
    return filtered.slice(0, Math.max(1, Math.min(200, limit ?? 50)));
  },
  plugin_check_media_missing: () => ["missing-audio.mp3"],
};
