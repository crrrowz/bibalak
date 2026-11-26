import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "./pluginHost";

/** Stand-in for a Web Worker: records what the host posts, lets tests fake plugin messages. */
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  /** Simulate the plugin calling raw `self.postMessage(msg)`, bypassing the bridge. */
  emit(msg: unknown) {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
  /** Simulate an uncaught Worker crash. */
  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

/**
 * Evaluates the real generated Worker bundle (bridge preamble + sample plugin JS)
 * inside an isolated Node `vm` context with no `window` or `document`.
 */
class EvalWorker {
  static all: EvalWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  private listeners: Array<(e: MessageEvent) => void> = [];

  constructor(code: string) {
    EvalWorker.all.push(this);
    const selfObj: Record<string, unknown> = {
      postMessage: (msg: unknown) => {
        this.onmessage?.({ data: msg } as MessageEvent);
      },
      addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
        if (type === "message") this.listeners.push(fn);
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
    queueMicrotask(() => {
      if (!this.terminated) {
        vm.runInContext(code, context);
      }
    });
  }

  postMessage(msg: unknown) {
    for (const fn of this.listeners) {
      fn({ data: msg } as MessageEvent);
    }
  }

  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.all = [];
  EvalWorker.all = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PluginHost capability enforcement", () => {
  it("ignores a command registration from a plugin without ui:command", () => {
    const host = new PluginHost();
    host.load("p1", [], "");
    FakeWorker.all[0].emit({ type: "register:command", id: "x", title: "X" });
    expect(host.commands).toEqual([]);
  });

  it("ignores a panel registration from a plugin without ui:panel", () => {
    const host = new PluginHost();
    host.load("p1", ["ui:command"], "");
    FakeWorker.all[0].emit({ type: "register:panel", id: "x", title: "X", blocks: [] });
    expect(host.panels).toEqual([]);
  });

  it("accepts registrations the manifest declares", () => {
    const host = new PluginHost();
    host.load("p1", ["ui:command"], "");
    FakeWorker.all[0].emit({ type: "register:command", id: "x", title: "X" });
    expect(host.commands).toEqual([{ pluginId: "p1", id: "x", title: "X" }]);
  });

  it("only sends events to plugins with events:listen", () => {
    const host = new PluginHost();
    host.load("quiet", [], "");
    host.load("listener", ["events:listen"], "");
    host.broadcastEvent({ type: "notes-changed" });
    expect(FakeWorker.all[0].posted).toEqual([]);
    expect(FakeWorker.all[1].posted).toEqual([{ type: "event", event: { type: "notes-changed" } }]);
  });

  it("invokes a command only in the plugin that registered it", () => {
    const host = new PluginHost();
    host.load("a", ["ui:command"], "");
    host.load("b", ["ui:command"], "");
    FakeWorker.all[0].emit({ type: "register:command", id: "same", title: "A" });
    FakeWorker.all[1].emit({ type: "register:command", id: "same", title: "B" });
    host.invokeCommand("b", "same");
    expect(FakeWorker.all[0].posted).toEqual([]);
    expect(FakeWorker.all[1].posted).toEqual([{ type: "invoke:command", id: "same" }]);
    expect(host.commands.map((c) => c.pluginId)).toEqual(["a", "b"]);
  });

  it("removes every command and panel of an unloaded plugin", () => {
    const host = new PluginHost();
    host.load("a", ["ui:command", "ui:panel"], "");
    const w = FakeWorker.all[0];
    w.emit({ type: "register:command", id: "one", title: "1" });
    w.emit({ type: "register:command", id: "two", title: "2" });
    w.emit({ type: "register:panel", id: "p", title: "P", blocks: [] });
    host.unload("a");
    expect(host.commands).toEqual([]);
    expect(host.panels).toEqual([]);
  });

  it("ignores malformed messages", () => {
    const host = new PluginHost();
    host.load("a", ["ui:command"], "");
    expect(() => FakeWorker.all[0].emit(null)).not.toThrow();
    expect(() => FakeWorker.all[0].emit("register:command")).not.toThrow();
    expect(host.commands).toEqual([]);
  });

  it("injects capability checks in the Worker bridge and blocks mismatched capabilities on host", async () => {
    const host = new PluginHost();
    host.load("panel-only", ["ui:panel"], "console.log('hi');");

    // Host enforces manifest permissions even if plugin bypasses bridge via raw postMessage.
    FakeWorker.all[0].emit({ type: "register:command", id: "cmd", title: "Sneaky" });
    expect(host.commands).toEqual([]);

    // Bridge preamble embeds the declared permission set and _check guard.
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    expect(text).toContain('var _perms = ["ui:panel"];');
    expect(text).toContain("function _check(cap)");
    expect(text).toContain('_check("ui:command")');
  });

  it("rejects data:request when plugin lacks read:decks or read:notes and enforces rate limits", async () => {
    const readDecks = vi.fn(async () => []);
    const readNotes = vi.fn(async () => []);
    const host = new PluginHost({ readDecks, readNotes, checkMediaMissing: async () => [] });
    host.load("no-data", ["ui:panel"], "");

    FakeWorker.all[0].emit({ type: "data:request", reqId: "r1", op: "decks:list" });
    FakeWorker.all[0].emit({
      type: "data:request",
      reqId: "r2",
      op: "notes:search",
      query: "",
      limit: 10,
    });
    await vi.waitFor(() => expect(FakeWorker.all[0].posted.length).toBe(2));
    expect(readDecks).not.toHaveBeenCalled();
    expect(readNotes).not.toHaveBeenCalled();
    expect(FakeWorker.all[0].posted[0]).toMatchObject({
      type: "data:response",
      reqId: "r1",
      ok: false,
    });

    // Rate limit enforcement
    host.load("deck-reader", ["read:decks"], "");
    const w = FakeWorker.all[1];
    for (let i = 0; i < 35; i++) {
      w.emit({ type: "data:request", reqId: `r-${i}`, op: "decks:list" });
    }
    await vi.waitFor(() => expect(w.posted.length).toBe(35));
    const failed = w.posted.filter((m) => (m as { ok: boolean }).ok === false) as Array<{
      ok: boolean;
      error?: string;
    }>;
    expect(failed.length).toBe(5);
    expect(failed[0]?.error).toMatch(/rate limit/i);
  });

  it("isolates Worker crashes, terminates the worker, clears contributions, and records crashed status", () => {
    const host = new PluginHost();
    host.load("crashy", ["ui:command", "ui:panel"], "");
    const w = FakeWorker.all[0];
    w.emit({ type: "register:command", id: "c1", title: "C1" });
    w.emit({ type: "register:panel", id: "p1", title: "P1", blocks: [] });

    w.crash("ReferenceError: boom is not defined");

    expect(w.terminated).toBe(true);
    expect(host.commands).toEqual([]);
    expect(host.panels).toEqual([]);
    expect(host.getStatus("crashy")).toEqual({
      status: "crashed",
      error: "ReferenceError: boom is not defined",
    });
  });

  it("loads and executes all 4 sample plugins end-to-end inside the sandbox bridge", async () => {
    const capturedCodes: string[] = [];
    vi.stubGlobal(
      "Worker",
      class extends EvalWorker {
        constructor() {
          super(capturedCodes[capturedCodes.length - 1] ?? "");
        }
      },
    );
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
      // Read synchronously from mocked Blob in jsdom/node via internal text if available
      void blob;
      return "blob:eval";
    });
    const origBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends origBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          capturedCodes.push((parts ?? []).map(String).join(""));
        }
      },
    );

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
