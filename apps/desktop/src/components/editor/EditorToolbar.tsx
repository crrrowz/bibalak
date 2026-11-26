import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import katex from "katex";
import { platform } from "@/lib/platform";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  List,
  ListOrdered,
  Eraser,
  Palette,
  Highlighter,
  Brackets,
  ImagePlus,
  Mic,
  Music,
  Sigma,
  Square,
} from "lucide-react";
import { ipc, isTauri } from "@/lib/ipc";
import { mediaUrl } from "@/lib/renderCard";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { insertClozeIntoEditor } from "@/components/editor/useActiveFieldEditor";

function ToolbarButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded transition-colors disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Shared formatting toolbar for an editor screen. Operates on the currently
 * focused (or last-focused) TipTap `Editor`, and renders in a disabled state
 * when `editor` is `null`.
 */
export function EditorToolbar({
  editor,
  nextClozeIndex,
  onCloze,
}: {
  editor: Editor | null;
  /** The cloze index the toolbar button proposes (shown in its tooltip). */
  nextClozeIndex: number;
  onCloze?: (index: number) => void;
}) {
  const tauri = isTauri();
  const activeEditor = editor && !editor.isDestroyed ? editor : null;
  const [, setEditorTick] = useState(0);
  const [mathOpen, setMathOpen] = useState(false);
  const [mathSrc, setMathSrc] = useState("");
  const [mathDisplay, setMathDisplay] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!activeEditor) {
      setMathOpen(false);
      return;
    }
    const onTransaction = () => setEditorTick((n) => (n + 1) & 0xffff);
    activeEditor.on("transaction", onTransaction);
    return () => {
      activeEditor.off("transaction", onTransaction);
    };
  }, [activeEditor]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const insertImageSrc = (filename: string) => {
    if (!activeEditor) return;
    const src = tauri ? mediaUrl(filename) : filename;
    activeEditor.chain().focus().setImage({ src, alt: filename }).run();
  };

  const insertAudioTag = (filename: string) => {
    if (!activeEditor) return;
    activeEditor.chain().focus().insertContent(`[sound:${filename}]`).run();
  };

  const pickImage = async () => {
    if (!activeEditor) return;
    if (tauri) {
      const path = await platform.pickPath({
        filters: [
          { name: t("editor.fileImage"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
        ],
      });
      if (path === null) return;
      const filename = await ipc.saveMediaFromPath(path);
      insertImageSrc(filename);
    } else {
      imageInputRef.current?.click();
    }
  };

  const pickAudio = async () => {
    if (!activeEditor) return;
    if (tauri) {
      const path = await platform.pickPath({
        filters: [{ name: t("editor.fileAudio"), extensions: ["mp3", "ogg", "wav", "m4a"] }],
      });
      if (path === null) return;
      const filename = await ipc.saveMediaFromPath(path);
      insertAudioTag(filename);
    } else {
      audioInputRef.current?.click();
    }
  };

  const handleFileInput = async (
    e: React.ChangeEvent<HTMLInputElement>,
    onSaved: (filename: string) => void,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (tauri) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filename = await ipc.saveMedia(bytes, file.name);
      onSaved(filename);
    } else {
      onSaved(URL.createObjectURL(file));
    }
  };

  const stopStreamTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const toggleRecording = async () => {
    if (recording && recorderRef.current) {
      setRecording(false);
      recorderRef.current.stop();
      return;
    }
    if (!activeEditor) return;

    setRecordError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordError(t("editor.recordingUnsupported"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setRecordError(t("editor.micPermissionDenied"));
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setRecordError(t("editor.micNotFound"));
      } else {
        setRecordError(t("editor.recordingFailed"));
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType =
      ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(
        (candidate) =>
          typeof MediaRecorder.isTypeSupported === "function"
            ? MediaRecorder.isTypeSupported(candidate)
            : false,
      ) ?? "";

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopStreamTracks();
        recorderRef.current = null;
        setRecording(false);
        setRecordError(t("editor.recordingFailed"));
      };

      recorder.onstop = () => {
        stopStreamTracks();
        recorderRef.current = null;
        const actualMime = recorder.mimeType || mimeType || "audio/webm";
        const ext = actualMime.includes("ogg")
          ? "ogg"
          : actualMime.includes("mp4") || actualMime.includes("m4a")
            ? "m4a"
            : "webm";
        const blob = new Blob(chunksRef.current, { type: actualMime });
        chunksRef.current = [];
        const filename = `recording-${Date.now()}.${ext}`;

        void (async () => {
          try {
            if (tauri) {
              const buffer =
                typeof blob.arrayBuffer === "function"
                  ? await blob.arrayBuffer()
                  : await new Response(blob).arrayBuffer();
              const saved = await ipc.saveMedia(new Uint8Array(buffer), filename);
              insertAudioTag(saved);
            } else {
              insertAudioTag(filename);
            }
          } catch {
            setRecordError(t("editor.recordingFailed"));
          }
        })();
      };

      recorder.start();
      setRecording(true);
    } catch {
      stopStreamTracks();
      recorderRef.current = null;
      setRecording(false);
      setRecordError(t("editor.recordingFailed"));
    }
  };

  const insertMath = () => {
    if (!activeEditor) return;
    const wrapped = mathDisplay ? `\\[${mathSrc}\\]` : `\\(${mathSrc}\\)`;
    activeEditor.chain().focus().insertContent(wrapped).run();
    setMathOpen(false);
    setMathSrc("");
  };

  let mathPreview = "";
  let mathError = false;
  try {
    mathPreview = mathSrc
      ? katex.renderToString(mathSrc, { displayMode: mathDisplay, throwOnError: true })
      : "";
  } catch {
    mathError = true;
  }

  const disabled = !activeEditor;

  return (
    <div
      role="toolbar"
      aria-label={t("editor.toolbarLabel")}
      aria-disabled={disabled || undefined}
      className={cn(
        "flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-muted/40 px-1.5 py-1",
        disabled && "opacity-60",
      )}
    >
      <ToolbarButton
        title={t("editor.bold")}
        disabled={disabled}
        active={activeEditor?.isActive("bold") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.italic")}
        disabled={disabled}
        active={activeEditor?.isActive("italic") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.underline")}
        disabled={disabled}
        active={activeEditor?.isActive("underline") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.strike")}
        disabled={disabled}
        active={activeEditor?.isActive("strike") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <label
        title={t("editor.textColor")}
        aria-disabled={disabled || undefined}
        className={cn(
          "relative flex size-7 items-center justify-center rounded text-muted-foreground",
          disabled
            ? "pointer-events-none opacity-40"
            : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Palette className="size-3.5" />
        <input
          type="color"
          disabled={disabled}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          onChange={(e) => activeEditor?.chain().focus().setColor(e.target.value).run()}
        />
      </label>
      <label
        title={t("editor.highlight")}
        aria-disabled={disabled || undefined}
        className={cn(
          "relative flex size-7 items-center justify-center rounded text-muted-foreground",
          disabled
            ? "pointer-events-none opacity-40"
            : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Highlighter className="size-3.5" />
        <input
          type="color"
          disabled={disabled}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          onChange={(e) =>
            activeEditor?.chain().focus().toggleHighlight({ color: e.target.value }).run()
          }
        />
      </label>
      <ToolbarButton
        title={t("editor.subscript")}
        disabled={disabled}
        active={activeEditor?.isActive("subscript") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.superscript")}
        disabled={disabled}
        active={activeEditor?.isActive("superscript") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        title={t("editor.bulletList")}
        disabled={disabled}
        active={activeEditor?.isActive("bulletList") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.numberedList")}
        disabled={disabled}
        active={activeEditor?.isActive("orderedList") ?? false}
        onClick={() => activeEditor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.clearFormatting")}
        disabled={disabled}
        onClick={() => activeEditor?.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <Eraser className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        title={t("editor.cloze", { n: nextClozeIndex })}
        disabled={disabled}
        onClick={() => {
          if (!activeEditor) return;
          if (onCloze) onCloze(nextClozeIndex);
          else insertClozeIntoEditor(activeEditor, nextClozeIndex);
        }}
      >
        <Brackets className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.insertImage")}
        disabled={disabled}
        onClick={() => void pickImage()}
      >
        <ImagePlus className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t("editor.insertAudio")}
        disabled={disabled}
        onClick={() => void pickAudio()}
      >
        <Music className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={recording}
        disabled={disabled && !recording}
        title={recording ? t("editor.stopRecording") : t("editor.recordAudio")}
        onClick={() => void toggleRecording()}
      >
        {recording ? (
          <Square className="size-3.5 fill-destructive text-destructive" />
        ) : (
          <Mic className="size-3.5" />
        )}
      </ToolbarButton>
      {recording && (
        <span className="px-1.5 text-xs font-medium text-destructive">{t("editor.recording")}</span>
      )}
      <ToolbarButton
        title={t("editor.insertMath")}
        disabled={disabled}
        onClick={() => setMathOpen((v) => !v)}
      >
        <Sigma className="size-3.5" />
      </ToolbarButton>

      {recordError && (
        <div
          role="alert"
          className="w-full border-t border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
        >
          {recordError}
        </div>
      )}

      {/* Web fallback file inputs (no Tauri dialog available). */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFileInput(e, insertImageSrc)}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleFileInput(e, insertAudioTag)}
      />

      {mathOpen && (
        <div className="w-full space-y-2 border-t border-border p-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={mathSrc}
              onChange={(e) => setMathSrc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && mathSrc && !mathError) insertMath();
                if (e.key === "Escape") {
                  setMathOpen(false);
                  activeEditor?.commands.focus();
                }
              }}
              placeholder={t("editor.mathPlaceholder")}
              className="h-8 flex-1 rounded border border-input bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={mathDisplay}
                onChange={(e) => setMathDisplay(e.target.checked)}
              />
              {t("editor.mathDisplay")}
            </label>
            <button
              type="button"
              onClick={insertMath}
              disabled={!mathSrc || mathError}
              className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              {t("editor.insert")}
            </button>
          </div>
          <div
            className={cn(
              "min-h-8 rounded border border-dashed border-border px-2 py-1.5 text-sm",
              mathError && "text-destructive",
            )}
          >
            {mathError ? (
              t("editor.invalidLatex")
            ) : mathSrc ? (
              <span dangerouslySetInnerHTML={{ __html: mathPreview }} />
            ) : (
              <span className="text-muted-foreground">{t("editor.preview")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
