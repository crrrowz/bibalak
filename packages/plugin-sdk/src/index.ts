// @bibalak/plugin-sdk — the public plugin API contract (MIT).
//
// This is the *stable* surface third-party plugins target for Bibalak API 0.2.0.
// Plugins execute inside a sandboxed Web Worker (`PluginHost`) and communicate
// with Bibalak exclusively through the capability-scoped `PluginContext`.
//
// Capabilities are declared in `plugin.json` (`permissions`) and enforced on
// both the frontend host and the Rust backend before any data leaves Bibalak.

// ── Version ───────────────────────────────────────────────────────────────────

/** Current plugin API version. Bumped on breaking changes to this contract. */
export const PLUGIN_API_VERSION = "0.2.0";

// ── Capabilities ─────────────────────────────────────────────────────────────

/** Capabilities active and enforced in plugin API 0.2.0. */
export type Capability = "read:notes" | "read:decks" | "ui:panel" | "ui:command" | "events:listen";

/**
 * Capabilities reserved for future API versions.
 * Declaring any of these in `plugin.json` is rejected at install time in 0.2.0.
 */
export type ReservedCapability =
  | "write:cards"
  | "ui:review-button"
  | "net:fetch"
  | "ai:card-hint"
  | "ai:note-fill-back"
  | "ai:deck-summary";

/** Any recognized capability identifier in a manifest. */
export type AnyCapability = Capability | ReservedCapability;

export const ACTIVE_CAPABILITIES: readonly Capability[] = [
  "read:notes",
  "read:decks",
  "ui:panel",
  "ui:command",
  "events:listen",
] as const;

export const RESERVED_CAPABILITIES: readonly ReservedCapability[] = [
  "write:cards",
  "ui:review-button",
  "net:fetch",
  "ai:card-hint",
  "ai:note-fill-back",
  "ai:deck-summary",
] as const;

// ── Manifest ─────────────────────────────────────────────────────────────────

/** Plugin manifest (`plugin.json`). */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Entry-point JS file path relative to the plugin root. */
  entry: string;
  description?: string;
  author?: string;
  /** Target Bibalak plugin-API version (0.2.x). */
  apiVersion: string;
  permissions: Capability[];
}

// ── Domain events ─────────────────────────────────────────────────────────────

/** Events a plugin with `events:listen` can subscribe to. */
export type PluginEvent =
  | { type: "card-answered" }
  | { type: "notes-changed" }
  | { type: "deck-changed" }
  | { type: "collection-opened" }
  | { type: "collection-closed" }
  | { type: "schema-changed" };

// ── Data DTOs (capability-scoped, sanitized) ─────────────────────────────────

/** Deck summary returned by `ctx.decks.list()` (`read:decks`). */
export interface PluginDeckSummary {
  id: number;
  name: string;
  parentId: number | null;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  dueToday: number;
  isFiltered: boolean;
}

/** Plain-text note field returned by `ctx.notes` (`read:notes`). HTML is stripped. */
export interface PluginNoteField {
  name: string;
  text: string;
}

/** Bounded note payload returned by `ctx.notes.search` / `ctx.notes.get` (`read:notes`). */
export interface PluginNoteSummary {
  noteId: number;
  deck: string;
  notetype: string;
  sortField: string;
  tags: string[];
  fields: PluginNoteField[];
  /** Local media filenames referenced in fields (no raw HTML). */
  mediaRefs: string[];
}

// ── UI extension points ───────────────────────────────────────────────────────

export interface CommandDefinition {
  id: string;
  title: string;
  /** Optional default keybinding hint, e.g. "mod+shift+k". */
  keybinding?: string;
  run: () => void | Promise<void>;
}

export type PanelTone = "default" | "muted" | "accent" | "warning" | "danger";

export interface PanelListItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  actionLabel?: string;
  actionId?: string;
  actionPayload?: unknown;
}

export interface PanelActionButton {
  id: string;
  label: string;
  variant?: "primary" | "secondary";
  payload?: unknown;
}

/**
 * Declarative UI blocks rendered safely by the Bibalak host inside a sidebar
 * drawer. Plugins never inject raw HTML or touch the app DOM.
 */
export type PanelBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string; tone?: PanelTone }
  | { type: "stat"; label: string; value: string }
  | { type: "badge"; text: string; tone?: PanelTone }
  | { type: "list"; items: PanelListItem[]; emptyText?: string }
  | { type: "actions"; buttons: PanelActionButton[] }
  | { type: "divider" };

export interface SidebarPanelDefinition {
  id: string;
  title: string;
  blocks: PanelBlock[];
  /** Invoked when the user clicks an action button or list item action in the panel. */
  onAction?: (actionId: string, payload?: unknown) => void | Promise<void>;
}

export interface SidebarPanelHandle extends Disposable {
  /** Replace the panel's rendered blocks. */
  update(blocks: PanelBlock[]): void;
}

// ── Plugin host context ───────────────────────────────────────────────────────

/** Returned by registration calls so plugins can clean up on deactivate. */
export interface Disposable {
  dispose(): void;
}

/** Handle passed to a plugin's `activate(ctx)` entry point. */
export interface PluginContext {
  readonly manifest: PluginManifest;
  /** Requires `ui:command`. */
  registerCommand(command: CommandDefinition): Disposable;
  /** Requires `ui:panel`. */
  addSidebarPanel(panel: SidebarPanelDefinition): SidebarPanelHandle;
  /** Show a brief notification toast to the user. */
  showToast(message: string): void;
  /** Requires `events:listen`. */
  onEvent(handler: (event: PluginEvent) => void): Disposable;
  /** Deck queries (requires `read:decks`). */
  readonly decks: {
    list(): Promise<PluginDeckSummary[]>;
  };
  /** Note queries (requires `read:notes`). All fields are plain text (never HTML). */
  readonly notes: {
    search(query: string, options?: { limit?: number }): Promise<PluginNoteSummary[]>;
    get(noteId: number): Promise<PluginNoteSummary | null>;
    checkMediaMissing(): Promise<string[]>;
  };
  /** Safe high-level navigation actions. */
  readonly navigation: {
    openDeck(deckId: number): void;
    openBrowse(query?: string): void;
  };
}

/** Shape a plugin's entry module registers via `BibalakPlugin.definePlugin(...)`. */
export interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** Global helper exposed inside the plugin Web Worker sandbox. */
export interface BibalakPluginGlobal {
  definePlugin(module: PluginModule): void;
}
