/**
 * Card render pipeline — runs after the Rust template engine produces HTML.
 *
 * Responsibilities:
 *  1. Walk the HTML in document order (one `DOMParser` pass) to build a
 *     single ordered playback queue mixing `[sound:name]` markers and
 *     `{{tts …:Field}}` markers (rendered by the engine as
 *     `.keepsake-tts` spans) — so mixed sound+TTS cards play back in the
 *     order they appear, not "files first, then speech".
 *  2. Rewrite bare-filename `<img src>` to bibalak-media:// URLs.
 */

/** Absolute URL for a media file served through the Tauri protocol handler. */
export function mediaUrl(filename: string): string {
  const encoded = encodeURIComponent(filename);
  return navigator.userAgent.includes("Windows")
    ? `http://bibalak-media.localhost/${encoded}`
    : `bibalak-media://localhost/${encoded}`;
}

export type QueueEntry =
  | { kind: "file"; name: string }
  | { kind: "tts"; text: string; lang: string; voices: string[]; rate: number };

export interface PreparedCard {
  /** HTML ready to inject into the DOM. */
  html: string;
  /** Sound files and TTS utterances, in document order, for sequenced playback. */
  queue: QueueEntry[];
}

const SOUND_RE = /\[sound:([^\]]+)\]/g;
const VIDEO_EXT_RE = /\.(mp4|webm|ogv|mov|m4v)(?:[?#].*)?$/i;

/**
 * Prepare raw card HTML for display:
 *  - render `[sound:*.mp4|webm|...]` markers inline as `<video controls>`
 *  - extract audio `[sound:...]` markers and `.keepsake-tts` spans into one ordered queue
 *  - rewrite relative image/video src URLs (Tauri only)
 */
export function prepareCard(html: string, tauri: boolean): PreparedCard {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const queue: QueueEntry[] = [];

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node: Node | null;
  const textNodesWithSounds: Text[] = [];
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.includes("[sound:")) {
        for (const m of text.matchAll(SOUND_RE)) {
          if (!VIDEO_EXT_RE.test(m[1])) {
            queue.push({ kind: "file", name: m[1] });
          }
        }
        textNodesWithSounds.push(node as Text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains("keepsake-tts")) {
        const text = el.dataset.text ?? "";
        if (text) {
          queue.push({
            kind: "tts",
            text,
            lang: el.dataset.lang ?? "",
            voices: (el.dataset.voices ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            rate: Number(el.dataset.rate) || 1,
          });
        }
      }
    }
  }
  for (const textNode of textNodesWithSounds) {
    const text = textNode.textContent ?? "";
    const frag = doc.createDocumentFragment();
    let lastIndex = 0;
    for (const m of text.matchAll(SOUND_RE)) {
      const start = m.index ?? 0;
      if (start > lastIndex) {
        frag.appendChild(doc.createTextNode(text.slice(lastIndex, start)));
      }
      const filename = m[1];
      if (VIDEO_EXT_RE.test(filename)) {
        const video = doc.createElement("video");
        video.setAttribute("controls", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("preload", "metadata");
        video.setAttribute("src", tauri ? mediaUrl(filename) : filename);
        frag.appendChild(video);
      }
      lastIndex = start + m[0].length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    textNode.replaceWith(frag);
  }

  if (tauri) {
    doc.querySelectorAll("img, video, source").forEach((el) => {
      const src = el.getAttribute("src") ?? "";
      if (src && !/^(data:|https?:|bibalak-media:)/i.test(src)) {
        el.setAttribute("src", mediaUrl(src));
      }
    });
  }

  return { html: doc.body.innerHTML, queue };
}
