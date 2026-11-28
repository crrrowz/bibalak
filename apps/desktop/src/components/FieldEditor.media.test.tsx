import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldEditor } from "./FieldEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useActiveFieldEditor } from "@/components/editor/useActiveFieldEditor";
import { ipc, isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { useSound } from "@/stores/sound";

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    isTauri: vi.fn(() => true),
    ipc: {
      ...actual.ipc,
      saveMedia: vi.fn(),
      saveMediaFromPath: vi.fn(),
    },
  };
});

beforeAll(() => {
  document.elementFromPoint = () => null;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = (() =>
    new DOMRect(0, 0, 0, 0)) as unknown as () => DOMRect;
});

function latestHtml(onChange: ReturnType<typeof vi.fn>): string | undefined {
  const calls = onChange.mock.calls;
  return calls.length > 0 ? (calls[calls.length - 1]?.[0] as string) : undefined;
}

function FieldWithSharedToolbar({
  value = "",
  onChange,
}: {
  value?: string;
  onChange: (html: string) => void;
}) {
  const { activeEditor, onFocusEditor, onDestroyEditor } = useActiveFieldEditor();
  return (
    <div>
      <EditorToolbar editor={activeEditor} nextClozeIndex={1} />
      <FieldEditor
        value={value}
        onChange={onChange}
        onFocusEditor={onFocusEditor}
        onDestroyEditor={onDestroyEditor}
      />
    </div>
  );
}

describe("FieldEditor media & literal insert (A2-25, A2-27, A2-28, A2-29)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isTauri as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("A2-25: inserting math with HTML-like brackets via EditorToolbar preserves literal '\\(a<b>c\\)' instead of parsing HTML tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FieldWithSharedToolbar onChange={onChange} />);

    const textbox = screen.getByRole("textbox");
    await user.click(textbox);

    const mathBtn = screen.getByRole("button", { name: /math/i });
    await user.click(mathBtn);
    const input = await screen.findByPlaceholderText(/x\^2|E=mc/i);
    await user.type(input, "a<b>c");
    const insertBtn = screen.getByRole("button", { name: /^Insert$/i });
    await user.click(insertBtn);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(latestHtml(onChange)).toContain("a&lt;b&gt;c");
  });

  it("A2-27: dropping an audio file (.mp3) onto FieldEditor saves it via saveMedia and inserts [sound:...]", async () => {
    (ipc.saveMedia as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("vocab.mp3");
    const onChange = vi.fn();
    render(<FieldEditor value="" onChange={onChange} />);

    const textbox = screen.getByRole("textbox");
    const audioFile = new File([new Uint8Array([0xff, 0xfb])], "vocab.mp3", {
      type: "audio/mpeg",
    });

    fireEvent.drop(textbox, {
      clientX: 10,
      clientY: 10,
      dataTransfer: {
        files: [audioFile],
        types: ["Files"],
      },
    });

    await waitFor(() => {
      expect(ipc.saveMedia).toHaveBeenCalledWith(expect.any(Uint8Array), "vocab.mp3");
    });
  });

  it("A2-28: pickImage in EditorToolbar catches saveMediaFromPath rejection and surfaces an error instead of unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);
    try {
      vi.spyOn(platform, "pickPath").mockResolvedValue("C:/too-big.png");
      (ipc.saveMediaFromPath as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("media file exceeds 100 MiB limit"),
      );

      const user = userEvent.setup();
      render(<FieldWithSharedToolbar onChange={vi.fn()} />);
      await user.click(screen.getByRole("textbox"));

      await user.click(screen.getByRole("button", { name: /insert image|image/i }));
      await new Promise((r) => setTimeout(r, 30));

      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("A2-29 & F12: [sound:vocab.mp3] renders chip, <img> shows labelled thumbnail, and plain-text toggle preserves raw HTML", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FieldEditor value='<b>[sound:vocab.mp3]</b> <img src="photo.png">' onChange={onChange} />,
    );
    const audioEl = document.querySelector("audio, [data-sound-chip], button[aria-label*='Play']");
    expect(audioEl).not.toBeNull();
    expect(screen.getByText(/Image: photo\.png/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show as plain text/i }));
    expect(
      screen.getByDisplayValue('<b>[sound:vocab.mp3]</b> <img src="photo.png">'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show formatted/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("syncs FieldEditor card audio playback volume live with Card audio store", async () => {
    const user = userEvent.setup();
    const instances: Array<{
      volume: number;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    }> = [];
    const OriginalAudio = globalThis.Audio;
    class MockAudio {
      volume = 1;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
      constructor() {
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", MockAudio);
    useSound.getState().setCardMuted(false);
    useSound.getState().setCardVolume(25);

    try {
      render(<FieldEditor value="[sound:clip.mp3]" onChange={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /Play clip\.mp3/i }));

      expect(instances).toHaveLength(1);
      expect(instances[0].volume).toBeCloseTo(0.25);

      useSound.getState().setCardVolume(70);
      expect(instances[0].volume).toBeCloseTo(0.7);

      useSound.getState().setCardMuted(true);
      expect(instances[0].volume).toBe(0);
    } finally {
      useSound.getState().setCardMuted(false);
      useSound.getState().setCardVolume(100);
      vi.stubGlobal("Audio", OriginalAudio);
    }
  });

  it("requires confirmation before removing media and offers inline Undo restore", async () => {
    const user = userEvent.setup();
    let current = '<b>Hello</b> <img src="shot.png">';
    const onChange = vi.fn((next: string) => {
      current = next;
    });

    const { rerender } = render(<FieldEditor value={current} onChange={onChange} />);

    // Clicking Remove once asks for confirmation instead of immediately deleting.
    await user.click(screen.getByRole("button", { name: /Remove shot\.png/i }));
    expect(onChange).not.toHaveBeenCalled();

    // Cancel aborts removal cleanly.
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onChange).not.toHaveBeenCalled();

    // Confirming removes the image and exposes an inline Undo control.
    await user.click(screen.getByRole("button", { name: /Remove shot\.png/i }));
    await user.click(screen.getByRole("button", { name: /^Remove$/i }));
    expect(onChange).toHaveBeenCalledWith("<b>Hello</b>");

    rerender(<FieldEditor value={current} onChange={onChange} />);
    expect(screen.getByText(/Removed shot\.png/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Undo$/i }));
    expect(onChange).toHaveBeenLastCalledWith('<b>Hello</b> <img src="shot.png">');
  });

  it("renders pure-image and pure-sound fields without a raw HTML/tag textbox or Show as plain text", () => {
    render(
      <div>
        <FieldEditor value='<img src="sub_line.png">' onChange={vi.fn()} />
        <FieldEditor value="[sound:voice.mp3]" mediaFieldKind="audio" onChange={vi.fn()} />
      </div>,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show as plain text/i })).toBeNull();
    expect(screen.getByAltText("sub_line.png")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Replace/i })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Play voice\.mp3/i })).toBeInTheDocument();
  });

  it("keeps rich-text editor when options.kind is explicitly 'text' even for image-only HTML", () => {
    render(
      <FieldEditor
        value='<img src="inline.png">'
        options={{ direction: "auto", font: "", size: 0, description: "", kind: "text" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show as plain text/i })).toBeInTheDocument();
  });
});
