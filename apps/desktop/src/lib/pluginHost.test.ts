import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_CHANNEL, PluginHost } from "./pluginHost";

function frameFor(pluginId: string): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-plugin-id="${pluginId}"]`);
  if (!frame) throw new Error(`Missing sandbox iframe for plugin ${pluginId}`);
  return frame;
}

function emitFromFrame(pluginId: string, msg: unknown) {
  const frame = frameFor(pluginId);
  window.dispatchEvent(
    new MessageEvent("message", {
      data:
        typeof msg === "object" && msg !== null
          ? { channel: PLUGIN_CHANNEL, ...(msg as Record<string, unknown>) }
          : msg,
      source: frame.contentWindow,
    }),
  );
}

function extractBundledCode(srcdoc: string): string {
  const match = srcdoc.match(/new Blob\(\[("(?:\\.|[^"\\])*")\]/);
  if (!match) throw new Error("Could not extract plugin bundle from sandbox srcdoc");
  return JSON.parse(match[1]) as string;
}

/**
 * Evaluates the real generated Worker bundle (bridge preamble + sample plugin JS)
 * inside an isolated Node `vm` context with no `window` or `document`, wired to
 * the plugin's sandbox `<iframe>` message channel.
 */
function attachEvalWorker(pluginId: string) {
  const frame = frameFor(pluginId);
  const code = extractBundledCode(frame.srcdoc);
  const posted: unknown[] = [];
  let terminated = false;
  const listeners: Array<(e: MessageEvent) => void> = [];

  const selfObj: Record<string, unknown> = {
    postMessage: (msg: unknown) => {
      if (terminated) return;
      emitFromFrame(pluginId, msg);
    },
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === "message") listeners.push(fn);
    },
    setInterval,
    clearInterval,
    console,
    Promise,
    Set,
    Map,
    String,
    Number,
    Array,
    Object,
    JSON,
    Error,
    Math,
  };
  selfObj.self = selfObj;
  const context = vm.createContext(selfObj);

  // Intercept parent -> iframe postMessage calls on frame.contentWindow.
  const win = frame.contentWindow as Window;
  vi.spyOn(win, "postMessage").mockImplementation((data: unknown) => {
    const d = data as { channel?: string; type?: string; payload?: unknown };
    if (d?.channel !== PLUGIN_CHANNEL) return;
    if (d.type === "host:terminate") {
      terminated = true;
      return;
    }
    posted.push(d.payload);
    for (const fn of listeners) {
      fn({ data: d.payload } as MessageEvent);
    }
  });

  emitFromFrame(pluginId, { type: "host:ready" });
  queueMicrotask(() => {
    if (!terminated) {
      vm.runInContext(code, context);
    }
  });

  return { posted };
}

function spyFramePosts(pluginId: string): unknown[] {
  const frame = frameFor(pluginId);
  const posted: unknown[] = [];
  const win = frame.contentWindow as Window;
  vi.spyOn(win, "postMessage").mockImplementation((data: unknown) => {
    const d = data as { channel?: string; payload?: unknown };
    if (d?.channel === PLUGIN_CHANNEL && "payload" in d) {
      posted.push(d.payload);
    }
  });
  emitFromFrame(pluginId, { type: "host:ready" });
  return posted;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll("iframe[data-plugin-id]").forEach((el) => el.remove());
});

describe("PluginHost capability enforcement", () => {
  it("mounts plugin inside an opaque-origin sandboxed iframe without a same-origin Worker and gates toast/navigation on permissions (A4-07)", () => {
    const WorkerSpy = vi.fn();
    vi.stubGlobal("Worker", WorkerSpy);

    const onToast = vi.fn();
    const openDeck = vi.fn();
    const openBrowse = vi.fn();

    const host = new PluginHost();
    host.onToast(onToast);
    host.setNavigationHandlers({ openDeck, openBrowse });

    host.load("zero-perm-plugin", [], "/* noop */");

    expect(WorkerSpy).not.toHaveBeenCalled();
    const frame = frameFor("zero-perm-plugin");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.srcdoc).toContain("new Worker");

    emitFromFrame("zero-perm-plugin", { type: "show:toast", message: "unpermissioned-toast" });
    emitFromFrame("zero-perm-plugin", { type: "navigate:deck", deckId: 42 });
    emitFromFrame("zero-perm-plugin", { type: "navigate:browse", query: "tag:secret" });

    expect(onToast).not.toHaveBeenCalled();
    expect(openDeck).not.toHaveBeenCalled();
    expect(openBrowse).not.toHaveBeenCalled();

    host.load("perm-plugin", ["ui:toast", "ui:navigate"], "/* noop */");
    emitFromFrame("perm-plugin", { type: "show:toast", message: "allowed-toast" });
    emitFromFrame("perm-plugin", { type: "navigate:deck", deckId: 42 });
    emitFromFrame("perm-plugin", { type: "navigate:browse", query: "tag:ok" });

    expect(onToast).toHaveBeenCalledWith({
      pluginId: "perm-plugin",
      message: "allowed-toast",
    });
    expect(openDeck).toHaveBeenCalledWith(42);
    expect(openBrowse).toHaveBeenCalledWith("tag:ok");

    host.destroyAll();
    expect(document.querySelectorAll("iframe[data-plugin-id]")).toHaveLength(0);
  });

  it("ignores a command registration from a plugin without ui:command", () => {
    const host = new PluginHost();
    host.load("p1", [], "");
    emitFromFrame("p1", { type: "register:command", id: "x", title: "X" });
    expect(host.commands).toEqual([]);
  });

  it("ignores a panel registration from a plugin without ui:panel", () => {
    const host = new PluginHost();
    host.load("p1", ["ui:command"], "");
    emitFromFrame("p1", { type: "register:panel", id: "x", title: "X", blocks: [] });
    expect(host.panels).toEqual([]);
  });

  it("blocks show:toast and navigation without ui:toast / ui:navigate", () => {
    const onToast = vi.fn();
    const openDeck = vi.fn();
    const openBrowse = vi.fn();
    const host = new PluginHost({ onNavigateDeck: openDeck, onNavigateBrowse: openBrowse });
    host.onToast(onToast);
    host.load("p1", ["ui:panel", "ui:command"], "");

    emitFromFrame("p1", { type: "show:toast", message: "blocked" });
    emitFromFrame("p1", { type: "navigate:deck", deckId: 1 });
    emitFromFrame("p1", { type: "navigate:browse", query: "tag:x" });

    expect(onToast).not.toHaveBeenCalled();
    expect(openDeck).not.toHaveBeenCalled();
    expect(openBrowse).not.toHaveBeenCalled();
  });

  it("accepts registrations the manifest declares", () => {
    const host = new PluginHost();
    host.load("p1", ["ui:command"], "");
    emitFromFrame("p1", { type: "register:command", id: "x", title: "X" });
    expect(host.commands).toEqual([{ pluginId: "p1", id: "x", title: "X" }]);
  });

  it("only sends events to plugins with events:listen", () => {
    const host = new PluginHost();
    host.load("quiet", [], "");
    host.load("listener", ["events:listen"], "");
    const quietPosted = spyFramePosts("quiet");
    const listenerPosted = spyFramePosts("listener");
    host.broadcastEvent({ type: "notes-changed" });
    expect(quietPosted).toEqual([]);
    expect(listenerPosted).toEqual([{ type: "event", event: { type: "notes-changed" } }]);
  });

  it("invokes a command only in the plugin that registered it", () => {
    const host = new PluginHost();
    host.load("a", ["ui:command"], "");
    host.load("b", ["ui:command"], "");
    const aPosted = spyFramePosts("a");
    const bPosted = spyFramePosts("b");
    emitFromFrame("a", { type: "register:command", id: "same", title: "A" });
    emitFromFrame("b", { type: "register:command", id: "same", title: "B" });
    host.invokeCommand("b", "same");
    expect(aPosted).toEqual([]);
    expect(bPosted).toEqual([{ type: "invoke:command", id: "same" }]);
    expect(host.commands.map((c) => c.pluginId)).toEqual(["a", "b"]);
  });

  it("removes every command, panel, and iframe of an unloaded plugin", () => {
    const host = new PluginHost();
    host.load("a", ["ui:command", "ui:panel"], "");
    emitFromFrame("a", { type: "register:command", id: "one", title: "1" });
    emitFromFrame("a", { type: "register:command", id: "two", title: "2" });
    emitFromFrame("a", { type: "register:panel", id: "p", title: "P", blocks: [] });
    host.unload("a");
    expect(host.commands).toEqual([]);
    expect(host.panels).toEqual([]);
    expect(document.querySelector('iframe[data-plugin-id="a"]')).toBeNull();
  });

  it("ignores malformed messages and wrong-source messages", () => {
    const host = new PluginHost();
    host.load("a", ["ui:command"], "");
    expect(() => emitFromFrame("a", null)).not.toThrow();
    expect(() => emitFromFrame("a", "register:command")).not.toThrow();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: PLUGIN_CHANNEL, type: "register:command", id: "spoof", title: "Spoof" },
        source: window,
      }),
    );
    expect(host.commands).toEqual([]);
  });

  it("injects capability checks in the Worker bridge and blocks mismatched capabilities on host", () => {
    const host = new PluginHost();
    host.load("panel-only", ["ui:panel"], "console.log('hi');");

    // Host enforces manifest permissions even if plugin bypasses bridge via raw postMessage.
    emitFromFrame("panel-only", { type: "register:command", id: "cmd", title: "Sneaky" });
    expect(host.commands).toEqual([]);

    // Bridge preamble embeds the declared permission set and _check guard inside opaque iframe.
    const code = extractBundledCode(frameFor("panel-only").srcdoc);
    expect(code).toContain('var _perms = ["ui:panel"];');
    expect(code).toContain("function _check(cap)");
    expect(code).toContain('_check("ui:command")');
    expect(code).toContain('_check("ui:toast")');
    expect(code).toContain('_check("ui:navigate")');
  });

  it("rejects data:request when plugin lacks read:decks or read:notes and enforces rate limits", async () => {
    const readDecks = vi.fn(async () => []);
    const readNotes = vi.fn(async () => []);
    const host = new PluginHost({ readDecks, readNotes, checkMediaMissing: async () => [] });
    host.load("no-data", ["ui:panel"], "");
    const noDataPosted = spyFramePosts("no-data");

    emitFromFrame("no-data", { type: "data:request", reqId: "r1", op: "decks:list" });
    emitFromFrame("no-data", {
      type: "data:request",
      reqId: "r2",
      op: "notes:search",
      query: "",
      limit: 10,
    });
    await vi.waitFor(() => expect(noDataPosted.length).toBe(2));
    expect(readDecks).not.toHaveBeenCalled();
    expect(readNotes).not.toHaveBeenCalled();
    expect(noDataPosted[0]).toMatchObject({
      type: "data:response",
      reqId: "r1",
      ok: false,
    });

    // Rate limit enforcement
    host.load("deck-reader", ["read:decks"], "");
    const readerPosted = spyFramePosts("deck-reader");
    for (let i = 0; i < 35; i++) {
      emitFromFrame("deck-reader", { type: "data:request", reqId: `r-${i}`, op: "decks:list" });
    }
    await vi.waitFor(() => expect(readerPosted.length).toBe(35));
    const failed = readerPosted.filter((m) => (m as { ok: boolean }).ok === false) as Array<{
      ok: boolean;
      error?: string;
    }>;
    expect(failed.length).toBe(5);
    expect(failed[0]?.error).toMatch(/rate limit/i);
  });

  it("isolates Worker crashes, removes the sandbox iframe, clears contributions, and records crashed status", () => {
    const host = new PluginHost();
    host.load("crashy", ["ui:command", "ui:panel"], "");
    emitFromFrame("crashy", { type: "register:command", id: "c1", title: "C1" });
    emitFromFrame("crashy", { type: "register:panel", id: "p1", title: "P1", blocks: [] });

    emitFromFrame("crashy", {
      type: "plugin:error",
      message: "ReferenceError: boom is not defined",
    });

    expect(document.querySelector('iframe[data-plugin-id="crashy"]')).toBeNull();
    expect(host.commands).toEqual([]);
    expect(host.panels).toEqual([]);
    expect(host.getStatus("crashy")).toEqual({
      status: "crashed",
      error: "ReferenceError: boom is not defined",
    });
  });

  it("loads and executes all 4 sample plugins end-to-end inside the sandbox bridge", async () => {
    const openDeck = vi.fn();
    const openBrowse = vi.fn();
    const host = new PluginHost({
      readDecks: async () => [
        {
          id: 2,
          name: "Cardiology",
          parentId: null,
          newCount: 3,
          learningCount: 1,
          reviewCount: 4,
          dueToday: 8,
          isFiltered: false,
        },
      ],
      readNotes: async (_id, query) => {
        if (query === "tag:leech") {
          return [
            {
              noteId: 10,
              deck: "Cardiology",
              notetype: "Basic",
              sortField: "Hard card",
              tags: ["leech"],
              fields: [
                { name: "Front", text: "Hard card" },
                { name: "Back", text: "Answer" },
              ],
              mediaRefs: [],
            },
          ];
        }
        return [
          {
            noteId: 11,
            deck: "Cardiology",
            notetype: "Basic",
            sortField: "Broken media",
            tags: [],
            fields: [
              { name: "Front", text: "Broken media" },
              { name: "Back", text: "Has answer" },
            ],
            mediaRefs: ["missing.png"],
          },
          {
            noteId: 12,
            deck: "Cardiology",
            notetype: "Basic",
            sortField: "Blank answer",
            tags: [],
            fields: [
              { name: "Front", text: "Blank answer" },
              { name: "Back", text: "" },
            ],
            mediaRefs: [],
          },
        ];
      },
      checkMediaMissing: async () => ["missing.png"],
      onNavigateDeck: openDeck,
      onNavigateBrowse: openBrowse,
    });

    const sampleDirs = ["focus-timer", "today-at-a-glance", "leech-helper", "note-checker"];
    for (const dir of sampleDirs) {
      const root = resolve(process.cwd(), "../../examples/plugins", dir);
      const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8")) as {
        id: string;
        name: string;
        version: string;
        entry: string;
        apiVersion: string;
        permissions: string[];
      };
      const code = readFileSync(resolve(root, manifest.entry), "utf8");
      host.load(manifest.id, manifest.permissions, code, manifest);
      attachEvalWorker(manifest.id);
    }

    // Focus timer: wait for Worker boot, then card-answered increments count
    await vi.waitFor(() => {
      expect(host.panels.find((p) => p.pluginId === "bibalak-focus-timer")).toBeDefined();
    });
    host.broadcastEvent({ type: "card-answered" });
    await vi.waitFor(() => {
      const focus = host.panels.find((p) => p.pluginId === "bibalak-focus-timer");
      expect(JSON.stringify(focus?.blocks)).toContain('"value":"1"');
    });

    // Today at a glance: study-next command opens deck 2
    await vi.waitFor(() => {
      const todayPanel = host.panels.find((p) => p.pluginId === "bibalak-today-glance");
      expect(JSON.stringify(todayPanel?.blocks)).toContain("Cardiology");
    });
    host.invokeCommand("bibalak-today-glance", "study-next-deck");
    await vi.waitFor(() => expect(openDeck).toHaveBeenCalledWith(2));

    // Leech helper: list-leeches command opens Browse with tag:leech
    host.invokeCommand("bibalak-leech-helper", "list-leeches");
    await vi.waitFor(() => expect(openBrowse).toHaveBeenCalledWith("tag:leech"));

    // Note checker: detects empty field & missing media
    await vi.waitFor(() => {
      const checker = host.panels.find((p) => p.pluginId === "bibalak-note-checker");
      const text = JSON.stringify(checker?.blocks ?? []);
      expect(text).toContain("Empty field: Back");
      expect(text).toContain("Missing media: missing.png");
    });

    host.destroyAll();
  });
});
