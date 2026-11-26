/**
 * Sandboxed card frame.
 *
 * Card HTML comes from imported decks and may contain scripts and inline
 * `on*` handlers (Anki templates rely on them). It is rendered inside an
 * `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so it runs
 * in an opaque origin: no access to the app window, the Tauri IPC bridge,
 * app storage or cookies. The app talks to it only through `postMessage`,
 * and each side checks `event.source` before trusting a message.
 *
 * Everything that needs app code (sound/TTS queue, media URLs, KaTeX, the
 * typed-answer diff, TTS voice names) runs here in the parent, on an inert
 * `DOMParser` document, before the HTML is sent to the frame.
 */
import renderMathInElement from "katex/contrib/auto-render";
// Vite `?inline` returns the stylesheet text.
import katexCss from "katex/dist/katex.min.css?inline";
import cardBaseCss from "@/styles/card-base.css?inline";
import { prepareCard, type QueueEntry } from "@/lib/renderCard";
import { diffTypedAnswer } from "@/lib/typedAnswerDiff";
import { loadVoices } from "@/lib/tts";
import { t } from "@/lib/i18n";

/** Exactly what the card frame may do: run its own scripts, nothing else. */
export const CARD_FRAME_SANDBOX = "allow-scripts";
export const CARD_CHANNEL = "keepsake-card";

const KATEX_OPTIONS = {
  delimiters: [
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true },
    { left: "$$", right: "$$", display: true },
    { left: "$", right: "$", display: false },
  ],
  throwOnError: false,
} as const;

// ── Messages ──────────────────────────────────────────────────────────────────

export type FrameMessage =
  | { type: "ready" }
  | { type: "typed"; value: string }
  | { type: "height"; value: number }
  | { type: "wantsFocus" }
  | {
      type: "key";
      key: string;
      code: string;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    };

/** Validate a message posted by the card frame; anything malformed is dropped. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.channel !== CARD_CHANNEL) return null;
  switch (d.type) {
    case "ready":
    case "wantsFocus":
      return { type: d.type };
    case "typed":
      return typeof d.value === "string"
        ? { type: "typed", value: d.value.slice(0, 10_000) }
        : null;
    case "height":
      return typeof d.value === "number" && Number.isFinite(d.value) && d.value >= 0
        ? { type: "height", value: Math.min(d.value, 1_000_000) }
        : null;
    case "key":
      if (typeof d.key !== "string" || d.key.length > 32) return null;
      return {
        type: "key",
        key: d.key,
        code: typeof d.code === "string" ? d.code.slice(0, 32) : "",
        ctrlKey: d.ctrlKey === true,
        shiftKey: d.shiftKey === true,
        altKey: d.altKey === true,
        metaKey: d.metaKey === true,
      };
    default:
      return null;
  }
}

// ── Preparing card HTML (parent side) ─────────────────────────────────────────

export interface FramePayload {
  html: string;
  queue: QueueEntry[];
}

/**
 * Prepare card HTML for the frame. Parsing happens in an inert document, so
 * nothing in the card (scripts, `onerror` handlers, images) runs or loads here.
 */
export async function prepareForFrame(
  html: string,
  opts: { tauri: boolean; typedAnswer?: string },
): Promise<FramePayload> {
  const prepared = prepareCard(html, opts.tauri);
  const doc = new DOMParser().parseFromString(prepared.html, "text/html");

  renderMathInElement(doc.body, KATEX_OPTIONS);

  const typeans = doc.querySelector<HTMLElement>(".keepsake-typeans");
  if (typeans) {
    typeans.innerHTML = diffTypedAnswer(opts.typedAnswer ?? "", typeans.dataset.expected ?? "");
  }

  const voiceEls = doc.querySelectorAll<HTMLElement>(".keepsake-tts-voices");
  if (voiceEls.length > 0) {
    const voices = await loadVoices();
    const names = voices.map((v) => `${v.name} (${v.lang})`).join(", ");
    voiceEls.forEach((el) => {
      el.textContent = names || t("card.noVoices");
    });
  }

  return { html: doc.body.innerHTML, queue: prepared.queue };
}

/** Current values of the theme variables a card stylesheet refers to. */
export function themeVariables(...css: string[]): string {
  const names = new Set<string>();
  for (const sheet of css) {
    for (const m of sheet.matchAll(/var\(\s*--([\w-]+)/g)) names.add(m[1]);
  }
  const computed = getComputedStyle(document.documentElement);
  const decls = [...names]
    .map((n) => [n, computed.getPropertyValue(`--${n}`).trim()] as const)
    .filter(([, v]) => v && !/[;{}<]/.test(v))
    .map(([n, v]) => `--${n}: ${v};`);
  return `:root { ${decls.join(" ")} }`;
}

// ── Static frame stylesheet (fonts inlined) ───────────────────────────────────

let staticCssPromise: Promise<string> | null = null;

/**
 * Base card CSS + KaTeX CSS + the app font, with font files inlined as data
 * URIs: the frame's opaque origin would otherwise need CORS headers to load
 * them from the app.
 */
export function frameStaticCss(): Promise<string> {
  staticCssPromise ??= (async () => {
    const appFonts = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .filter(
        // Only the Latin UI font: Arabic card text uses the system Arabic font
        // (inlining every Plex weight would add ~200 KB to each card frame).
        (rule) => rule.cssText.startsWith("@font-face") && rule.cssText.includes("Figtree"),
      )
      .map((rule) => rule.cssText)
      .join("\n");
    return inlineFontUrls(`${appFonts}\n${katexCss}\n${cardBaseCss}`);
  })();
  return staticCssPromise;
}

async function inlineFontUrls(css: string): Promise<string> {
  const urls = new Set<string>();
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)) urls.add(m[1]);
  const inlined = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const res = await fetch(new URL(url, document.baseURI));
        if (!res.ok) return;
        inlined.set(url, await blobToDataUrl(await res.blob(), "font/woff2"));
      } catch {
        // Best effort: an unreachable font falls back to the next family.
      }
    }),
  );
  return css.replace(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g, (whole, url: string) => {
    const data = inlined.get(url);
    return data ? `url("${data}")` : whole;
  });
}

function blobToDataUrl(blob: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, `data:${type};`));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── Frame document ────────────────────────────────────────────────────────────

/**
 * Runs inside the sandboxed frame. Plain ES5-style JS (it is not bundled).
 * Accepts `render` messages only from the parent window; reports height,
 * typed input and keyboard shortcuts back.
 */
const FRAME_RUNTIME = `(function () {
  var CHANNEL = ${JSON.stringify(CARD_CHANNEL)};
  var root = document.querySelector(".keepsake-card-root");
  var focusTarget = null;
  var lastHeight = -1;

  function send(msg) {
    msg.channel = CHANNEL;
    window.parent.postMessage(msg, "*");
  }

  function reportHeight() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (h !== lastHeight) {
      lastHeight = h;
      send({ type: "height", value: h });
    }
  }

  function activateScripts() {
    root.querySelectorAll("script").forEach(function (old) {
      var s = document.createElement("script");
      for (var i = 0; i < old.attributes.length; i++) {
        s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      }
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
  }

  function wireBehaviour() {
    root.querySelectorAll(".keepsake-hint").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var body = link.nextElementSibling;
        if (body && body.classList.contains("keepsake-hint-body")) {
          body.hidden = false;
          link.style.display = "none";
        }
      });
    });
    root.querySelectorAll('.keepsake-io-shape[data-revealed="false"]').forEach(function (shape) {
      shape.style.cursor = "pointer";
      shape.addEventListener("click", function () {
        shape.dataset.revealed = "true";
      });
    });
    focusTarget = root.querySelector(".keepsake-type-input");
    if (focusTarget) {
      var input = focusTarget;
      input.addEventListener("input", function () {
        send({ type: "typed", value: input.value });
      });
      send({ type: "wantsFocus" });
      input.focus();
    }
  }

  function applyVolume(vol) {
    var v = typeof vol === "number" && !isNaN(vol) ? Math.max(0, Math.min(1, vol)) : 1;
    root.querySelectorAll("audio, video").forEach(function (el) {
      el.volume = v;
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var d = event.data;
    if (!d || d.channel !== CHANNEL) return;
    if (d.type === "volume") {
      applyVolume(d.volume);
      return;
    }
    if (d.type !== "render") return;
    document.getElementById("ks-theme").textContent = String(d.theme || "");
    document.getElementById("ks-notetype").textContent = String(d.css || "");
    document.documentElement.style.colorScheme = d.night ? "dark" : "light";
    root.style.zoom = typeof d.scale === "number" && d.scale > 0 && d.scale !== 1 ? String(d.scale) : "";
    root.classList.toggle("night_mode", !!d.night);
    root.classList.toggle("nightMode", !!d.night);
    root.innerHTML = String(d.html || "");
    activateScripts();
    wireBehaviour();
    applyVolume(d.volume);
    reportHeight();
  });

  window.addEventListener("focus", function () {
    if (focusTarget) focusTarget.focus();
  });

  document.addEventListener("keydown", function (e) {
    var t = e.target;
    var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing && e.key !== "Enter" && e.key !== "Escape") return;
    send({
      type: "key", key: e.key, code: e.code,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
    });
  }, true);

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener("load", reportHeight);
  send({ type: "ready" });
})();`;

/** The frame's `srcdoc`. `css` is trusted app CSS (see `frameStaticCss`). */
export function buildFrameDocument({ css }: { css: string }): string {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; user-select: text; }</style>
<style id="ks-static">${safeCss}</style>
<style id="ks-theme"></style>
<style id="ks-notetype"></style>
</head>
<body><div class="card keepsake-card-root" dir="auto"></div><script>${FRAME_RUNTIME}</script></body>
</html>`;
}
