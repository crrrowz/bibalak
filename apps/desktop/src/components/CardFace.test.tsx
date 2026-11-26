import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardFace } from "./CardFace";
import {
  buildFrameDocument,
  parseFrameMessage,
  prepareForFrame,
  themeVariables,
} from "@/lib/cardFrame";
import { useSound } from "@/stores/sound";

/**
 * Card HTML comes from imported decks and may carry scripts. It must render in
 * a sandboxed iframe (opaque origin: no access to the app window, its IPC
 * bridge or its storage), never inside the app document itself.
 */
async function renderFace(props: Partial<React.ComponentProps<typeof CardFace>> = {}) {
  const utils = render(
    <CardFace
      html={'<b id="card-marker">Q</b><script>window.parent.__pwned = true;</script>'}
      css=""
      tauri={false}
      night={false}
      {...props}
    />,
  );
  const frame = await waitFor(() => {
    const f = utils.container.querySelector("iframe");
    if (!f) throw new Error("no iframe yet");
    return f;
  });
  return { ...utils, frame };
}

function postFromFrame(frame: HTMLIFrameElement | null, data: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, source: (frame?.contentWindow ?? window) as Window }),
    );
  });
}

describe("CardFace isolation", () => {
  it("renders card HTML in an iframe sandboxed to scripts only", async () => {
    const { frame } = await renderFace();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(document.getElementById("card-marker")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("accepts typed input only from its own frame", async () => {
    const onTypedInput = vi.fn();
    const { frame } = await renderFace({ onTypedInput });

    postFromFrame(null, { channel: "keepsake-card", type: "typed", value: "spoofed" });
    expect(onTypedInput).not.toHaveBeenCalled();

    postFromFrame(frame, { channel: "keepsake-card", type: "typed", value: "aspirin" });
    expect(onTypedInput).toHaveBeenCalledWith("aspirin");
  });

  it("forwards keyboard shortcuts pressed inside the card to the app", async () => {
    const { frame } = await renderFace();
    const seen: string[] = [];
    const onKey = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", onKey);
    postFromFrame(frame, { channel: "keepsake-card", type: "key", key: "3", code: "Digit3" });
    window.removeEventListener("keydown", onKey);
    expect(seen).toEqual(["3"]);
  });

  it("sizes the frame to the height the card reports", async () => {
    const { frame } = await renderFace();
    postFromFrame(frame, { channel: "keepsake-card", type: "height", value: 321 });
    expect(frame.style.height).toBe("321px");
  });

  it("OT-11/U8: forwards app volume to the card frame on render and on change", async () => {
    useSound.setState({ volume: 80, muted: false, effectiveVolume: 0.8 });
    const { frame } = await renderFace();
    const postSpy = vi.fn();
    if (frame.contentWindow) {
      frame.contentWindow.postMessage = postSpy;
    }
    postFromFrame(frame, { channel: "keepsake-card", type: "ready" });
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "keepsake-card",
          type: "render",
          volume: 0.8,
        }),
        "*",
      );
    });
    act(() => {
      useSound.getState().setVolume(40);
    });
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "keepsake-card",
          type: "volume",
          volume: 0.4,
        }),
        "*",
      );
    });
  });
});

describe("prepareForFrame", () => {
  it("fills the typed-answer diff before the HTML leaves the app", async () => {
    const out = await prepareForFrame(
      '<span class="keepsake-typeans" data-expected="cat"></span>',
      {
        tauri: false,
        typedAnswer: "cat",
      },
    );
    expect(out.html).toContain("keepsake-typeans-diff");
  });

  it("collects the sound queue and strips the markers", async () => {
    const out = await prepareForFrame("hi [sound:a.mp3]", { tauri: false });
    expect(out.queue).toEqual([{ kind: "file", name: "a.mp3" }]);
    expect(out.html).not.toContain("[sound:");
  });
});

describe("buildFrameDocument", () => {
  it("never references the Tauri bridge and only trusts its parent", () => {
    const doc = buildFrameDocument({ css: ".card{}" });
    expect(doc).not.toMatch(/__TAURI/);
    expect(doc).toContain("event.source !== window.parent");
  });
});

describe("cardFrame message & CSS guards (ADR-004 / H1)", () => {
  it("rejects wrong channels, invalid heights, and oversized keys in parseFrameMessage", () => {
    expect(parseFrameMessage(null)).toBeNull();
    expect(parseFrameMessage({ channel: "other", type: "ready" })).toBeNull();
    expect(parseFrameMessage({ channel: "keepsake-card", type: "height", value: -5 })).toBeNull();
    expect(
      parseFrameMessage({ channel: "keepsake-card", type: "height", value: Number.NaN }),
    ).toBeNull();
    expect(
      parseFrameMessage({ channel: "keepsake-card", type: "key", key: "A".repeat(33) }),
    ).toBeNull();
    expect(parseFrameMessage({ channel: "keepsake-card", type: "typed", value: 42 })).toBeNull();
  });

  it("strips CSS injection characters from theme variables", () => {
    document.documentElement.style.setProperty("--good-var", "#123456");
    document.documentElement.style.setProperty("--evil-var", "red; } body { display: none");
    const css = themeVariables("color: var(--good-var); background: var(--evil-var);");
    expect(css).toContain("--good-var: #123456;");
    expect(css).not.toContain("--evil-var");
    document.documentElement.style.removeProperty("--good-var");
    document.documentElement.style.removeProperty("--evil-var");
  });
});
