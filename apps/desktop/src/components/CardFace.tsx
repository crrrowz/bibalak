import { useEffect, useRef, useState } from "react";
import cardBaseCss from "@/styles/card-base.css?inline";
import type { QueueEntry } from "@/lib/renderCard";
import {
  CARD_CHANNEL,
  CARD_FRAME_SANDBOX,
  buildFrameDocument,
  frameStaticCss,
  parseFrameMessage,
  prepareForFrame,
  themeVariables,
  type FrameMessage,
} from "@/lib/cardFrame";
import { t } from "@/lib/i18n";
import { getCardEffectiveVolume, useSound } from "@/stores/sound";

interface CardFaceProps {
  /** Rendered question/answer HTML from the Rust template engine. */
  html: string;
  /** The active notetype's custom card CSS (scoped to this face's frame). */
  css: string;
  tauri: boolean;
  night: boolean;
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Called with the sound+TTS playback queue, in document order, whenever `html` changes. */
  onQueue?: (queue: QueueEntry[]) => void;
  /** Called on every keystroke in a `{{type:Field}}` input (front side only). */
  onTypedInput?: (value: string) => void;
  /** What the user typed on the front side, to diff against `.keepsake-typeans` (back side only). */
  typedAnswer?: string;
}

const SAFE_STUDY_CODES = new Set([
  "Space",
  "Enter",
  "Escape",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Numpad1",
  "Numpad2",
  "Numpad3",
  "Numpad4",
  "KeyZ",
  "KeyF",
  "KeyT",
  "KeyR",
  "KeyS",
  "KeyB",
]);

const SAFE_STUDY_KEYS = new Set([
  " ",
  "enter",
  "escape",
  "1",
  "2",
  "3",
  "4",
  "z",
  "f",
  "t",
  "r",
  "s",
  "b",
]);

function isSafeStudyKey(msg: Extract<FrameMessage, { type: "key" }>): boolean {
  if (msg.ctrlKey || msg.metaKey || msg.altKey) return false;
  if (msg.code) return SAFE_STUDY_CODES.has(msg.code);
  return SAFE_STUDY_KEYS.has(msg.key.toLowerCase());
}

/**
 * Renders one card face in a sandboxed iframe (see `lib/cardFrame.ts`): card
 * templates and their scripts come from imported decks, so they get an opaque
 * origin with no access to the app or its IPC. Per-notetype CSS stays scoped
 * to the frame; theme colors are passed in as CSS variables.
 */
export function CardFace({
  html,
  css,
  tauri,
  night,
  scale = 1,
  className,
  style,
  onQueue,
  onTypedInput,
  typedAnswer,
}: CardFaceProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const onTypedRef = useRef(onTypedInput);
  onTypedRef.current = onTypedInput;
  const onQueueRef = useRef(onQueue);
  onQueueRef.current = onQueue;
  const effectiveVolume = useSound((s) => s.effectiveVolume);

  // Build the frame document once (fonts are inlined asynchronously).
  useEffect(() => {
    let cancelled = false;
    void frameStaticCss().then((staticCss) => {
      if (!cancelled) setSrcDoc(buildFrameDocument({ css: staticCss }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const post = (msg: Record<string, unknown>) => {
    pendingRef.current = msg;
    if (readyRef.current) frameRef.current?.contentWindow?.postMessage(msg, "*");
  };

  useEffect(() => {
    if (pendingRef.current) {
      pendingRef.current = { ...pendingRef.current, volume: effectiveVolume };
    }
    if (readyRef.current) {
      frameRef.current?.contentWindow?.postMessage(
        {
          channel: CARD_CHANNEL,
          type: "volume",
          volume: effectiveVolume,
        },
        "*",
      );
    }
  }, [effectiveVolume]);

  // Prepare the card in the app, then hand the inert result to the frame.
  useEffect(() => {
    let cancelled = false;
    void prepareForFrame(html, { tauri, typedAnswer }).then((prepared) => {
      if (cancelled) return;
      onQueueRef.current?.(prepared.queue);
      post({
        channel: CARD_CHANNEL,
        type: "render",
        html: prepared.html,
        css: css || "",
        night,
        scale,
        theme: themeVariables(cardBaseCss, css || ""),
        volume: getCardEffectiveVolume(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [html, css, tauri, night, scale, typedAnswer]);

  // Messages from this face's frame only.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const msg = parseFrameMessage(event.data);
      if (!msg) return;
      switch (msg.type) {
        case "ready":
          readyRef.current = true;
          if (pendingRef.current) frame.contentWindow?.postMessage(pendingRef.current, "*");
          break;
        case "typed":
          onTypedRef.current?.(msg.value);
          break;
        case "height":
          frame.style.height = `${msg.value}px`;
          break;
        case "wantsFocus":
          frame.focus();
          break;
        case "key":
          if (!isSafeStudyKey(msg)) break;
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: msg.key,
              code: msg.code,
              ctrlKey: false,
              shiftKey: msg.shiftKey,
              altKey: false,
              metaKey: false,
              bubbles: true,
              cancelable: true,
            }),
          );
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className={className} style={style}>
      {srcDoc !== null && (
        <iframe
          ref={frameRef}
          title={t("card.frameTitle")}
          sandbox={CARD_FRAME_SANDBOX}
          srcDoc={srcDoc}
          className="block w-full border-0 bg-transparent"
          style={{ colorScheme: night ? "dark" : "light" }}
        />
      )}
    </div>
  );
}
