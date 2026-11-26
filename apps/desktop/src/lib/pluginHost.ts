/**
 * Plugin host: creates one sandboxed Web Worker per enabled plugin (ADR-003).
 *
 * Each plugin runs its entry-point JS inside a dedicated Web Worker. The host
 * injects a bridge preamble before the plugin code that exposes a
 * capability-scoped `BibalakPlugin.definePlugin(...)` API and constructs the
 * `PluginContext` passed to `activate(ctx)`.
 *
 * All capabilities, input limits, and per-plugin rate limits are enforced here
 * on the host (and again in Rust IPC commands), never trusting the Worker.
 */
import type {
  Capability,
  PanelBlock,
  PluginDeckSummary,
  PluginEvent,
  PluginManifest,
  PluginNoteSummary,
} from "@bibalak/plugin-sdk";
import { ipc } from "@/lib/ipc";

export interface PluginCommand {
  pluginId: string;
  id: string;
  title: string;
  keybinding?: string;
}

export interface PluginPanel {
  pluginId: string;
  id: string;
  title: string;
  blocks: PanelBlock[];
}

export type PluginToast = { pluginId: string; message: string };

export interface PluginRuntimeStatus {
  status: "running" | "crashed" | "stopped";
  error?: string;
}

export interface PluginDataBridge {
  readDecks?: (pluginId: string) => Promise<PluginDeckSummary[]>;
  readNotes?: (pluginId: string, query: string, limit: number) => Promise<PluginNoteSummary[]>;
  checkMediaMissing?: (pluginId: string) => Promise<string[]>;
  onNavigateDeck?: (deckId: number) => void;
  onNavigateBrowse?: (query: string) => void;
}

export interface PluginSnapshot {
  commands: readonly PluginCommand[];
  panels: readonly PluginPanel[];
  statuses: ReadonlyMap<string, PluginRuntimeStatus>;
  activePanelKey: string | null;
}

export interface PluginHostHandlers {
  onCommand: (cmd: PluginCommand) => void;
  onDisposeCommand: (pluginId: string, id: string) => void;
  onPanel: (panel: PluginPanel) => void;
  onUpdatePanel: (pluginId: string, id: string, blocks: PanelBlock[]) => void;
  onDisposePanel: (pluginId: string, id: string) => void;
  onToast: (toast: PluginToast) => void;
  onCrash: (pluginId: string, error: string) => void;
}

const DATA_RATE_WINDOW_MS = 10_000;
const DATA_RATE_MAX_CALLS = 30;
const MAX_NOTES_LIMIT = 200;
const MAX_QUERY_CHARS = 500;
const MAX_TOAST_CHARS = 500;
const MAX_PANEL_BLOCKS = 100;

/** Manages the lifecycle of one plugin Worker. */
export class PluginWorker {
  private worker: Worker;
  private readonly permissions: ReadonlySet<string>;
  private readonly requestTimes: number[] = [];
  private destroyed = false;

  constructor(
    public readonly pluginId: string,
    permissions: string[],
    entryCode: string,
    private readonly handlers: PluginHostHandlers,
    private readonly bridge: PluginDataBridge,
    manifest?: Omit<Partial<PluginManifest>, "permissions"> & { permissions?: string[] },
  ) {
    this.permissions = new Set(permissions);
    const resolvedManifest: PluginManifest = {
      id: manifest?.id ?? pluginId,
      name: manifest?.name ?? pluginId,
      version: manifest?.version ?? "0.0.0",
      entry: manifest?.entry ?? "index.js",
      description: manifest?.description,
      author: manifest?.author,
      apiVersion: manifest?.apiVersion ?? "0.2.0",
      permissions: permissions as Capability[],
    };
    const code = buildBridge(permissions, resolvedManifest) + "\n;\n" + entryCode;
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);

    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      const msg = e?.message || "Uncaught worker error";
      console.error(`[plugin:${pluginId}] worker error:`, msg);
      this.handleCrash(msg);
    };
  }

  private handleCrash(message: string) {
    if (this.destroyed) return;
    this.destroy();
    this.handlers.onCrash(this.pluginId, message);
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    while (this.requestTimes.length > 0 && now - this.requestTimes[0] > DATA_RATE_WINDOW_MS) {
      this.requestTimes.shift();
    }
    if (this.requestTimes.length >= DATA_RATE_MAX_CALLS) {
      return false;
    }
    this.requestTimes.push(now);
    return true;
  }

  /** Capability checks run here, on the host: the in-Worker bridge checks are
   *  convenience only, since plugin code can call raw `self.postMessage`. */
  private onMessage(msg: unknown) {
    if (this.destroyed || typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case "register:command":
        if (!this.permissions.has("ui:command")) return this.denied("ui:command");
        if (typeof m.id !== "string" || !m.id || typeof m.title !== "string" || !m.title) return;
        this.handlers.onCommand({
          pluginId: this.pluginId,
          id: m.id.slice(0, 128),
          title: m.title.slice(0, 200),
          keybinding: typeof m.keybinding === "string" ? m.keybinding.slice(0, 64) : undefined,
        });
        break;
      case "dispose:command":
        if (!this.permissions.has("ui:command")) return this.denied("ui:command");
        if (typeof m.id !== "string") return;
        this.handlers.onDisposeCommand(this.pluginId, m.id);
        break;
      case "register:panel":
        if (!this.permissions.has("ui:panel")) return this.denied("ui:panel");
        if (typeof m.id !== "string" || !m.id || typeof m.title !== "string" || !m.title) return;
        this.handlers.onPanel({
          pluginId: this.pluginId,
          id: m.id.slice(0, 128),
          title: m.title.slice(0, 120),
          blocks: sanitizeBlocks(m.blocks),
        });
        break;
      case "update:panel":
        if (!this.permissions.has("ui:panel")) return this.denied("ui:panel");
        if (typeof m.id !== "string" || !m.id) return;
        this.handlers.onUpdatePanel(this.pluginId, m.id, sanitizeBlocks(m.blocks));
        break;
      case "dispose:panel":
        if (!this.permissions.has("ui:panel")) return this.denied("ui:panel");
        if (typeof m.id !== "string") return;
        this.handlers.onDisposePanel(this.pluginId, m.id);
        break;
      case "show:toast":
        if (typeof m.message !== "string") return;
        this.handlers.onToast({
          pluginId: this.pluginId,
          message: m.message.slice(0, MAX_TOAST_CHARS),
        });
        break;
      case "navigate:deck": {
        const deckId = Number(m.deckId);
        if (!Number.isSafeInteger(deckId) || deckId <= 0) return;
        this.bridge.onNavigateDeck?.(deckId);
        break;
      }
      case "navigate:browse": {
        const query = typeof m.query === "string" ? m.query.slice(0, MAX_QUERY_CHARS) : "";
        this.bridge.onNavigateBrowse?.(query);
        break;
      }
      case "data:request":
        void this.handleDataRequest(m);
        break;
      case "plugin:error":
        this.handleCrash(typeof m.message === "string" ? m.message : "Plugin threw an error");
        break;
    }
  }

  private async handleDataRequest(m: Record<string, unknown>) {
    const reqId = typeof m.reqId === "string" ? m.reqId : "";
    const op = typeof m.op === "string" ? m.op : "";
    const reply = (ok: boolean, data?: unknown, error?: string) => {
      if (this.destroyed) return;
      this.worker.postMessage({ type: "data:response", reqId, ok, data, error });
    };

    if (!reqId) return;

    if (!this.checkRateLimit()) {
      reply(false, undefined, "Plugin data rate limit exceeded; try again shortly.");
      return;
    }

    try {
      if (op === "decks:list") {
        if (!this.permissions.has("read:decks")) {
          this.denied("read:decks");
          reply(false, undefined, "Permission denied: read:decks");
          return;
        }
        const decks = await (this.bridge.readDecks
          ? this.bridge.readDecks(this.pluginId)
          : defaultReadDecks(this.pluginId));
        reply(true, decks);
        return;
      }

      if (op === "notes:search") {
        if (!this.permissions.has("read:notes")) {
          this.denied("read:notes");
          reply(false, undefined, "Permission denied: read:notes");
          return;
        }
        const query = typeof m.query === "string" ? m.query.slice(0, MAX_QUERY_CHARS) : "";
        const rawLimit = typeof m.limit === "number" && Number.isFinite(m.limit) ? m.limit : 50;
        const limit = Math.max(1, Math.min(MAX_NOTES_LIMIT, Math.trunc(rawLimit)));
        const notes = await (this.bridge.readNotes
          ? this.bridge.readNotes(this.pluginId, query, limit)
          : defaultReadNotes(this.pluginId, query, limit));
        reply(true, notes);
        return;
      }

      if (op === "notes:get") {
        if (!this.permissions.has("read:notes")) {
          this.denied("read:notes");
          reply(false, undefined, "Permission denied: read:notes");
          return;
        }
        const noteId = Number(m.noteId);
        if (!Number.isSafeInteger(noteId) || noteId <= 0) {
          reply(false, undefined, "Invalid noteId");
          return;
        }
        const notes = await (this.bridge.readNotes
          ? this.bridge.readNotes(this.pluginId, "", MAX_NOTES_LIMIT)
          : defaultReadNotes(this.pluginId, "", MAX_NOTES_LIMIT));
        reply(true, notes.find((n) => n.noteId === noteId) ?? null);
        return;
      }

      if (op === "notes:check-media-missing") {
        if (!this.permissions.has("read:notes")) {
          this.denied("read:notes");
          reply(false, undefined, "Permission denied: read:notes");
          return;
        }
        const missing = await (this.bridge.checkMediaMissing
          ? this.bridge.checkMediaMissing(this.pluginId)
          : ipc.pluginCheckMediaMissing(this.pluginId));
        reply(true, missing);
        return;
      }

      reply(false, undefined, `Unsupported data operation: ${op}`);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      reply(false, undefined, msg);
    }
  }

  private denied(cap: string) {
    console.warn(`[plugin:${this.pluginId}] blocked: missing permission ${cap}`);
  }

  invokeCommand(id: string) {
    if (this.destroyed) return;
    this.worker.postMessage({ type: "invoke:command", id });
  }

  invokePanelAction(panelId: string, actionId: string, payload?: unknown) {
    if (this.destroyed) return;
    this.worker.postMessage({ type: "invoke:panel-action", panelId, actionId, payload });
  }

  sendEvent(event: PluginEvent | unknown) {
    if (this.destroyed || !this.permissions.has("events:listen")) return;
    this.worker.postMessage({ type: "event", event });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.worker.terminate();
  }
}

async function defaultReadDecks(pluginId: string): Promise<PluginDeckSummary[]> {
  const rows = await ipc.pluginReadDecks(pluginId);
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    newCount: d.new_count,
    learningCount: d.learning_count,
    reviewCount: d.review_count,
    dueToday: d.due_today,
    isFiltered: d.is_filtered,
  }));
}

async function defaultReadNotes(
  pluginId: string,
  query: string,
  limit: number,
): Promise<PluginNoteSummary[]> {
  const rows = await ipc.pluginReadNotes(pluginId, query, limit);
  return rows.map((n) => ({
    noteId: n.note_id,
    deck: n.deck,
    notetype: n.notetype,
    sortField: n.sort_field,
    tags: n.tags,
    fields: n.fields,
    mediaRefs: n.media_refs,
  }));
}

function sanitizeBlocks(raw: unknown): PanelBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelBlock[] = [];
  for (const item of raw.slice(0, MAX_PANEL_BLOCKS)) {
    if (typeof item !== "object" || item === null) continue;
    const b = item as Record<string, unknown>;
    switch (b.type) {
      case "heading":
      case "text":
      case "badge":
        if (typeof b.text === "string") {
          out.push({
            type: b.type,
            text: b.text.slice(0, 1000),
            ...(typeof b.tone === "string"
              ? { tone: b.tone as PanelBlock & { tone: never } extends never ? never : "default" }
              : {}),
          } as PanelBlock);
        }
        break;
      case "stat":
        if (typeof b.label === "string" && typeof b.value === "string") {
          out.push({
            type: "stat",
            label: b.label.slice(0, 120),
            value: b.value.slice(0, 120),
          });
        }
        break;
      case "divider":
        out.push({ type: "divider" });
        break;
      case "actions":
        if (Array.isArray(b.buttons)) {
          out.push({
            type: "actions",
            buttons: b.buttons
              .slice(0, 12)
              .filter(
                (btn): btn is Record<string, unknown> => typeof btn === "object" && btn !== null,
              )
              .map((btn) => ({
                id: String(btn.id ?? "").slice(0, 64),
                label: String(btn.label ?? "").slice(0, 80),
                variant: (btn.variant === "primary" ? "primary" : "secondary") as
                  | "primary"
                  | "secondary",
                payload: btn.payload,
              }))
              .filter((btn) => btn.id && btn.label),
          });
        }
        break;
      case "list":
        if (Array.isArray(b.items)) {
          out.push({
            type: "list",
            emptyText: typeof b.emptyText === "string" ? b.emptyText.slice(0, 200) : undefined,
            items: b.items
              .slice(0, 100)
              .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
              .map((it) => ({
                id: String(it.id ?? "").slice(0, 64),
                title: String(it.title ?? "").slice(0, 200),
                subtitle: typeof it.subtitle === "string" ? it.subtitle.slice(0, 200) : undefined,
                badge: typeof it.badge === "string" ? it.badge.slice(0, 40) : undefined,
                actionLabel:
                  typeof it.actionLabel === "string" ? it.actionLabel.slice(0, 60) : undefined,
                actionId: typeof it.actionId === "string" ? it.actionId.slice(0, 64) : undefined,
                actionPayload: it.actionPayload,
              }))
              .filter((it) => it.id && it.title),
          });
        }
        break;
    }
  }
  return out;
}

export function panelKey(pluginId: string, id: string): string {
  return `${pluginId}::${id}`;
}

/** Host: manages all active plugin Workers. */
export class PluginHost {
  private workers = new Map<string, PluginWorker>();
  readonly commands: PluginCommand[] = [];
  readonly panels: PluginPanel[] = [];
  private statuses = new Map<string, PluginRuntimeStatus>();
  private activePanelKey: string | null = null;
  private toastListeners: Array<(t: PluginToast) => void> = [];
  private changeListeners: Array<() => void> = [];
  private bridge: PluginDataBridge;
  private snapshot: PluginSnapshot;

  constructor(bridge: PluginDataBridge = {}) {
    this.bridge = bridge;
    this.snapshot = this.buildSnapshot();
  }

  private buildSnapshot(): PluginSnapshot {
    return {
      commands: [...this.commands],
      panels: [...this.panels],
      statuses: new Map(this.statuses),
      activePanelKey: this.activePanelKey,
    };
  }

  private notify() {
    this.snapshot = this.buildSnapshot();
    this.changeListeners.forEach((fn) => fn());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((f) => f !== listener);
    };
  };

  getSnapshot = (): PluginSnapshot => {
    return this.snapshot;
  };

  setNavigationHandlers(handlers: {
    openDeck?: (deckId: number) => void;
    openBrowse?: (query: string) => void;
  }) {
    this.bridge.onNavigateDeck = handlers.openDeck;
    this.bridge.onNavigateBrowse = handlers.openBrowse;
  }

  openPanel(pluginId: string, id: string) {
    this.activePanelKey = panelKey(pluginId, id);
    this.notify();
  }

  closePanel() {
    if (this.activePanelKey === null) return;
    this.activePanelKey = null;
    this.notify();
  }

  getStatus(pluginId: string): PluginRuntimeStatus {
    return this.statuses.get(pluginId) ?? { status: "stopped" };
  }

  private makeHandlers(): PluginHostHandlers {
    return {
      onCommand: (cmd) => {
        const idx = this.commands.findIndex((c) => c.pluginId === cmd.pluginId && c.id === cmd.id);
        if (idx === -1) {
          this.commands.push(cmd);
        } else {
          this.commands[idx] = cmd;
        }
        this.notify();
      },
      onDisposeCommand: (pluginId, id) => {
        removeWhere(this.commands, (c) => c.pluginId === pluginId && c.id === id);
        this.notify();
      },
      onPanel: (panel) => {
        const idx = this.panels.findIndex(
          (p) => p.pluginId === panel.pluginId && p.id === panel.id,
        );
        if (idx === -1) {
          this.panels.push(panel);
        } else {
          this.panels[idx] = panel;
        }
        this.notify();
      },
      onUpdatePanel: (pluginId, id, blocks) => {
        const existing = this.panels.find((p) => p.pluginId === pluginId && p.id === id);
        if (existing) {
          existing.blocks = blocks;
          this.notify();
        }
      },
      onDisposePanel: (pluginId, id) => {
        removeWhere(this.panels, (p) => p.pluginId === pluginId && p.id === id);
        if (this.activePanelKey === panelKey(pluginId, id)) {
          this.activePanelKey = null;
        }
        this.notify();
      },
      onToast: (toast) => {
        this.toastListeners.forEach((fn) => fn(toast));
      },
      onCrash: (pluginId, error) => {
        this.workers.delete(pluginId);
        removeWhere(this.commands, (c) => c.pluginId === pluginId);
        removeWhere(this.panels, (p) => p.pluginId === pluginId);
        if (this.activePanelKey?.startsWith(`${pluginId}::`)) {
          this.activePanelKey = null;
        }
        this.statuses.set(pluginId, { status: "crashed", error });
        this.toastListeners.forEach((fn) =>
          fn({ pluginId, message: `${pluginId} crashed: ${error}` }),
        );
        this.notify();
      },
    };
  }

  onToast(fn: (t: PluginToast) => void) {
    this.toastListeners.push(fn);
    return () => {
      this.toastListeners = this.toastListeners.filter((f) => f !== fn);
    };
  }

  load(
    pluginId: string,
    permissions: string[],
    entryCode: string,
    manifest?: Omit<Partial<PluginManifest>, "permissions"> & { permissions?: string[] },
  ) {
    this.unload(pluginId);
    this.statuses.set(pluginId, { status: "running" });
    const worker = new PluginWorker(
      pluginId,
      permissions,
      entryCode,
      this.makeHandlers(),
      this.bridge,
      manifest,
    );
    this.workers.set(pluginId, worker);
    this.notify();
  }

  unload(pluginId: string) {
    const existing = this.workers.get(pluginId);
    if (existing) {
      existing.destroy();
      this.workers.delete(pluginId);
    }
    removeWhere(this.commands, (c) => c.pluginId === pluginId);
    removeWhere(this.panels, (p) => p.pluginId === pluginId);
    if (this.activePanelKey?.startsWith(`${pluginId}::`)) {
      this.activePanelKey = null;
    }
    this.statuses.delete(pluginId);
    this.notify();
  }

  /** Invoke a command in the plugin that registered it — never in others that reuse the id. */
  invokeCommand(pluginId: string, id: string) {
    this.workers.get(pluginId)?.invokeCommand(id);
  }

  invokePanelAction(pluginId: string, panelId: string, actionId: string, payload?: unknown) {
    this.workers.get(pluginId)?.invokePanelAction(panelId, actionId, payload);
  }

  broadcastEvent(event: PluginEvent | unknown) {
    for (const worker of this.workers.values()) {
      worker.sendEvent(event);
    }
  }

  destroyAll() {
    for (const worker of this.workers.values()) {
      worker.destroy();
    }
    this.workers.clear();
    this.commands.length = 0;
    this.panels.length = 0;
    this.statuses.clear();
    this.activePanelKey = null;
    this.notify();
  }
}

function removeWhere<T>(items: T[], pred: (item: T) => boolean) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) items.splice(i, 1);
  }
}

/** Singleton host shared across the app. */
export const pluginHost = new PluginHost();

// ── Bridge preamble ────────────────────────────────────────────────────────────

function buildBridge(permissions: string[], manifest: PluginManifest): string {
  return `
(function() {
  var _perms = ${JSON.stringify(permissions)};
  var _manifest = ${JSON.stringify(manifest)};
  function _check(cap) {
    if (_perms.indexOf(cap) === -1) throw new Error("Plugin permission denied: " + cap);
  }
  var _commandHandlers = {};
  var _panelActionHandlers = {};
  var _eventListeners = [];
  var _pendingRequests = {};
  var _reqSeq = 0;
  var _activeModule = null;

  function _requestData(op, payload) {
    return new Promise(function(resolve, reject) {
      var reqId = "req-" + (++_reqSeq);
      _pendingRequests[reqId] = { resolve: resolve, reject: reject };
      var msg = Object.assign({ type: "data:request", reqId: reqId, op: op }, payload || {});
      self.postMessage(msg);
    });
  }

  function _reportCrash(err) {
    var msg = err && err.message ? String(err.message) : String(err);
    self.postMessage({ type: "plugin:error", message: msg });
  }

  var _ctx = {
    manifest: Object.freeze(_manifest),
    registerCommand: function(command) {
      _check("ui:command");
      if (!command || typeof command.id !== "string" || typeof command.title !== "string" || typeof command.run !== "function") {
        throw new Error("registerCommand requires { id, title, run }");
      }
      _commandHandlers[command.id] = command.run;
      self.postMessage({
        type: "register:command",
        id: command.id,
        title: command.title,
        keybinding: command.keybinding,
      });
      return {
        dispose: function() {
          delete _commandHandlers[command.id];
          self.postMessage({ type: "dispose:command", id: command.id });
        },
      };
    },
    addSidebarPanel: function(panel) {
      _check("ui:panel");
      if (!panel || typeof panel.id !== "string" || typeof panel.title !== "string") {
        throw new Error("addSidebarPanel requires { id, title, blocks }");
      }
      if (typeof panel.onAction === "function") {
        _panelActionHandlers[panel.id] = panel.onAction;
      }
      self.postMessage({
        type: "register:panel",
        id: panel.id,
        title: panel.title,
        blocks: Array.isArray(panel.blocks) ? panel.blocks : [],
      });
      return {
        update: function(blocks) {
          self.postMessage({
            type: "update:panel",
            id: panel.id,
            blocks: Array.isArray(blocks) ? blocks : [],
          });
        },
        dispose: function() {
          delete _panelActionHandlers[panel.id];
          self.postMessage({ type: "dispose:panel", id: panel.id });
        },
      };
    },
    showToast: function(message) {
      self.postMessage({ type: "show:toast", message: String(message) });
    },
    onEvent: function(handler) {
      _check("events:listen");
      if (typeof handler !== "function") {
        throw new Error("onEvent requires a function");
      }
      _eventListeners.push(handler);
      return {
        dispose: function() {
          _eventListeners = _eventListeners.filter(function(fn) { return fn !== handler; });
        },
      };
    },
    decks: {
      list: function() {
        _check("read:decks");
        return _requestData("decks:list");
      },
    },
    notes: {
      search: function(query, options) {
        _check("read:notes");
        return _requestData("notes:search", {
          query: query == null ? "" : String(query),
          limit: options && typeof options.limit === "number" ? options.limit : 50,
        });
      },
      get: function(noteId) {
        _check("read:notes");
        return _requestData("notes:get", { noteId: noteId });
      },
      checkMediaMissing: function() {
        _check("read:notes");
        return _requestData("notes:check-media-missing");
      },
    },
    navigation: {
      openDeck: function(deckId) {
        self.postMessage({ type: "navigate:deck", deckId: deckId });
      },
      openBrowse: function(query) {
        self.postMessage({ type: "navigate:browse", query: query == null ? "" : String(query) });
      },
    },
  };

  self.BibalakPlugin = {
    definePlugin: function(mod) {
      _activeModule = mod;
      if (mod && typeof mod.activate === "function") {
        try {
          var res = mod.activate(_ctx);
          if (res && typeof res.catch === "function") {
            res.catch(_reportCrash);
          }
        } catch (err) {
          _reportCrash(err);
        }
      }
    },
  };

  self.addEventListener("message", function(e) {
    var data = e.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "data:response" && data.reqId && _pendingRequests[data.reqId]) {
      var pending = _pendingRequests[data.reqId];
      delete _pendingRequests[data.reqId];
      if (data.ok) {
        pending.resolve(data.data);
      } else {
        pending.reject(new Error(data.error || "Plugin request failed"));
      }
      return;
    }
    if (data.type === "invoke:command" && _commandHandlers[data.id]) {
      try {
        var r = _commandHandlers[data.id]();
        if (r && typeof r.catch === "function") r.catch(_reportCrash);
      } catch (err) {
        _reportCrash(err);
      }
      return;
    }
    if (data.type === "invoke:panel-action" && _panelActionHandlers[data.panelId]) {
      try {
        var pr = _panelActionHandlers[data.panelId](data.actionId, data.payload);
        if (pr && typeof pr.catch === "function") pr.catch(_reportCrash);
      } catch (err) {
        _reportCrash(err);
      }
      return;
    }
    if (data.type === "event") {
      for (var i = 0; i < _eventListeners.length; i++) {
        try {
          _eventListeners[i](data.event);
        } catch (err) {
          _reportCrash(err);
        }
      }
    }
  });
})();
`;
}
