import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldEditor } from "./FieldEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useActiveFieldEditor } from "@/components/editor/useActiveFieldEditor";
import { toDisplayHtml, toStorageHtml } from "@/lib/editorMedia";
import { ipc, isTauri } from "@/lib/ipc";

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

function latestHtml(onChange: ReturnType<typeof vi.fn>): string | undefined {
  const calls = onChange.mock.calls;
  return calls.length > 0 ? (calls[calls.length - 1]?.[0] as string) : undefined;
}

function FieldWithSharedToolbar({ onChange }: { onChange: (html: string) => void }) {
  const { activeEditor, onFocusEditor, onDestroyEditor } = useActiveFieldEditor();
  return (
    <div>
      <EditorToolbar editor={activeEditor} nextClozeIndex={1} />
      <FieldEditor
        value=""
        onChange={onChange}
        onFocusEditor={onFocusEditor}
        onDestroyEditor={onDestroyEditor}
      />
    </div>
  );
}

describe("FieldEditor E6 media & clean paste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isTauri as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = (() =>
        new DOMRect(0, 0, 0, 0)) as unknown as () => DOMRect;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sanitizes pasted HTML and keeps links, lists, formatting, and tables in editor output", () => {
    const onChange = vi.fn();
    render(<FieldEditor value="" onChange={onChange} />);

    const textbox = screen.getByRole("textbox");
    const clipboardHtml = `
      <p class="MsoNormal" style="color:red">
        <b>KeepBold</b> <u>KeepU</u> x<sup>2</sup>
        <a href="https://example.com">OkLink</a>
        <a href="javascript:alert(1)">BadLink</a>
      </p>
      <img src="https://track.test/p.gif" width="1" height="1" />
      <img src="photo.png" onerror="alert(1)" style="width:100px" alt="Photo" />
      <script>evil()</script>
      <table class="tbl" style="border:1px solid"><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>
    `;

    fireEvent.paste(textbox, {
      clipboardData: {
        types: ["text/html", "text/plain"],
        files: [],
        items: [],
        getData: (type: string) => (type === "text/html" ? clipboardHtml : ""),
      },
    });

    expect(onChange).toHaveBeenCalled();
    const html = latestHtml(onChange) ?? "";
    expect(html).toContain("KeepBold");
    expect(html).toContain("<u>KeepU</u>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("track.test/p.gif");
    expect(html).toContain('src="photo.png"');
    expect(html).toContain("<table>");
    expect(html).toContain("<th><p>Col</p></th>");
    expect(html).toContain("<td><p>Cell</p></td>");
  });

  it("saves pasted image via MediaStore and round-trips through storage/display HTML", async () => {
    (ipc.saveMedia as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("paste-dedup.png");
    const onChange = vi.fn();
    render(<FieldEditor value="" onChange={onChange} />);

    const textbox = screen.getByRole("textbox");
    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });

    fireEvent.paste(textbox, {
      clipboardData: {
        types: ["Files"],
        files: [file],
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        getData: () => "",
      },
    });

    await waitFor(() => {
      expect(ipc.saveMedia).toHaveBeenCalledWith(expect.any(Uint8Array), "shot.png");
    });

    await waitFor(() => {
      expect(latestHtml(onChange)).toContain('src="paste-dedup.png"');
    });

    const stored = latestHtml(onChange) ?? "";
    expect(stored).not.toContain("bibalak-media");
    const displayed = toDisplayHtml(stored, true);
    expect(displayed).toContain("bibalak-media");
    expect(toStorageHtml(displayed)).toBe(stored);
  });

  it("saves dropped image via MediaStore and inserts <img src>", async () => {
    (ipc.saveMedia as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("dropped-img.jpg");
    const onChange = vi.fn();
    render(<FieldEditor value="" onChange={onChange} />);

    const textbox = screen.getByRole("textbox");
    const file = new File([new Uint8Array([255, 216, 255])], "diagram.jpg", { type: "image/jpeg" });

    fireEvent.drop(textbox, {
      clientX: 10,
      clientY: 10,
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    await waitFor(() => {
      expect(ipc.saveMedia).toHaveBeenCalledWith(expect.any(Uint8Array), "diagram.jpg");
    });

    await waitFor(() => {
      expect(latestHtml(onChange)).toContain('src="dropped-img.jpg"');
    });
  });

  it("records audio via MediaRecorder, saves to MediaStore, and inserts [sound:name]", async () => {
    (ipc.saveMedia as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("voice-123.webm");
    const stopTrack = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    class MockMediaRecorder {
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      mimeType = "audio/webm";
      state = "inactive";
      static isTypeSupported = () => true;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
        });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    const onChange = vi.fn();
    render(<FieldWithSharedToolbar onChange={onChange} />);

    // Toolbar starts disabled when no field has been focused yet
    expect(screen.getByRole("toolbar")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTitle(/record/i)).toBeDisabled();

    fireEvent.focus(screen.getByRole("textbox"));
    expect(screen.getByTitle(/record/i)).toBeEnabled();

    fireEvent.click(screen.getByTitle(/record/i));
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    const stopBtn = await screen.findByTitle(/stop/i);
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(ipc.saveMedia).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.stringMatching(/\.webm$/),
      );
    });
    expect(stopTrack).toHaveBeenCalled();

    await waitFor(() => {
      expect(latestHtml(onChange)).toContain("[sound:voice-123.webm]");
    });
  });

  it("shows a clear message when microphone permission is denied", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", class {});

    render(<FieldWithSharedToolbar onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole("textbox"));
    fireEvent.click(screen.getByTitle(/record/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/microphone|permission/i);
  });
});
