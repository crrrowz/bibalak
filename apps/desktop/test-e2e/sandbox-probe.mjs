/* global process, setTimeout, fetch, WebSocket, console -- Node 22 script */
// Card-sandbox regression test against the REAL Tauri webview (ADR-004).
//
// Start the app with WebView2's DevTools port open, then run:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 <app>
//   node apps/desktop/test-e2e/sandbox-probe.mjs 9333
//
// It injects an iframe with exactly CardFace's sandbox ("allow-scripts", no
// allow-same-origin) and, from inside it, tries what a malicious shared deck
// would: call IPC, replay a stolen invoke key over postMessage, read the app
// window and storage, reach the network. A positive control sends the same
// postMessage from the main window to prove the attack would work there.
// Exit code 0 = sandbox holds; 1 = a check failed (details printed).
// Uses throwaway decks named __sandbox_probe_* and deletes them.

const port = Number(process.argv[2] ?? 9333);
const deadline = Date.now() + Number(process.env.PROBE_TIMEOUT_MS ?? 120_000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools:"));
      if (page) return page;
    } catch {
      // app not up yet
    }
    await wait(1000);
  }
  throw new Error(`no webview page on port ${port}`);
}

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
// Every default execution context we can see: the page's own (sessionId
// undefined) and those of out-of-process frames attached below.
const contexts = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Target.attachedToTarget") {
    // Enable Runtime in each attached frame so its contexts are reported.
    send("Runtime.enable", {}, m.params.sessionId);
  } else if (m.method === "Runtime.executionContextCreated") {
    if (m.params.context.auxData?.isDefault) {
      contexts.push({ sessionId: m.sessionId, contextId: m.params.context.id });
    }
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
async function evaluate(expression, sessionId, contextId) {
  const r = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) },
    sessionId,
  );
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluation failed");
  }
  return r.result?.result?.value;
}

await send("Runtime.enable");
await send("Target.setAutoAttach", {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
});

// Wait until the app's IPC bridge is ready in the main window.
while (Date.now() < deadline) {
  if ((await evaluate("typeof window.__TAURI_INTERNALS__?.invoke")) === "function") break;
  await wait(500);
}

const STEAL_KEY_AND_SEND = (deckName) => `(async () => {
  let key = null;
  const realSet = Headers.prototype.set;
  Headers.prototype.set = function (k, v) { if (k === "Tauri-Invoke-Key") key = v; return realSet.call(this, k, v); };
  try { await window.__TAURI_INTERNALS__.invoke("app_info"); } catch (e) {}
  Headers.prototype.set = realSet;
  const msg = JSON.stringify({ cmd: "create_deck", callback: 11, error: 12, payload: { name: "${deckName}" }, options: {}, __TAURI_INVOKE_KEY__: key });
  try { window.ipc && window.ipc.postMessage(msg); } catch (e) {}
  try { window.chrome && window.chrome.webview && window.chrome.webview.postMessage(msg); } catch (e) {}
  return key ? "key captured" : "no key";
})()`;

const decksNamed = (name) =>
  evaluate(
    `window.__TAURI_INTERNALS__.invoke("list_decks").then(d => d.filter(x => x.name === "${name}").map(x => x.id))`,
  );
const deleteDecks = async (ids) => {
  for (const id of ids)
    await evaluate(`window.__TAURI_INTERNALS__.invoke("delete_deck", { id: ${id} })`);
};

const failures = [];
const report = {};

// Positive control: the same attack from the main window must work, or the
// probe below proves nothing (e.g. the message format changed in Tauri).
const CONTROL = "__sandbox_probe_control__";
await evaluate(STEAL_KEY_AND_SEND(CONTROL));
await wait(1500);
const controlIds = await decksNamed(CONTROL);
report.controlCreatedDeck = controlIds.length > 0;
if (!report.controlCreatedDeck)
  failures.push("positive control did not create a deck — probe is not meaningful");
await deleteDecks(controlIds);

// The frame under test: same sandbox flags as CardFace. A unique window name
// lets us find exactly this frame, whether or not it runs out of process.
const token = `sandbox-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
await evaluate(`(() => {
  const f = document.createElement("iframe");
  f.id = "sandbox-probe";
  f.name = "${token}";
  f.setAttribute("sandbox", "allow-scripts");
  f.srcdoc = "<!doctype html><p>probe</p>";
  f.style.cssText = "position:fixed;width:1px;height:1px;opacity:0";
  document.body.append(f);
  return true;
})()`);
let frame = null;
while (!frame && Date.now() < deadline) {
  for (const c of [...contexts]) {
    try {
      if ((await evaluate("window.name", c.sessionId, c.contextId)) === token) frame = c;
    } catch {
      // context gone (navigation); skip
    }
  }
  if (!frame) await wait(250);
}
if (!frame) throw new Error("could not find the injected probe frame");
const inFrame = (expr) => evaluate(expr, frame.sessionId, frame.contextId);

report.frameOrigin = await inFrame("self.origin");
report.parentDocument = await inFrame(
  `(() => { try { return String(!!window.parent.document); } catch (e) { return "blocked"; } })()`,
);
report.localStorage = await inFrame(
  `(() => { try { return typeof localStorage.length; } catch (e) { return "blocked"; } })()`,
);
report.invoke = await inFrame(`Promise.race([
  window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke("app_info").then(() => "ANSWERED", () => "rejected") : Promise.resolve("no bridge"),
  new Promise((r) => setTimeout(() => r("no answer"), 3000)),
])`);
report.network = await inFrame(
  `fetch("https://example.com/").then(() => "reachable", () => "blocked")`,
);

const ATTACK = "__sandbox_probe_attack__";
report.frameKey = await inFrame(STEAL_KEY_AND_SEND(ATTACK));
await wait(2000);
const attackIds = await decksNamed(ATTACK);
report.attackCreatedDeck = attackIds.length > 0;
await deleteDecks(attackIds);
await evaluate(`document.getElementById("sandbox-probe")?.remove()`);

if (report.frameOrigin !== "null")
  failures.push(`frame origin is ${report.frameOrigin}, expected opaque "null"`);
if (report.parentDocument !== "blocked") failures.push("frame can read the app window");
if (report.localStorage !== "blocked") failures.push("frame can read app storage");
if (report.invoke === "ANSWERED") failures.push("IPC invoke answered inside the frame");
if (report.network !== "blocked") failures.push("frame reached the network");
if (report.attackCreatedDeck) failures.push("postMessage IPC from the frame created a deck");

console.log(JSON.stringify(report, null, 2));
ws.close();
if (failures.length > 0) {
  console.error("SANDBOX PROBE FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Sandbox probe passed.");
process.exit(0);
