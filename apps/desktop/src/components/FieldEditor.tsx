import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";
import { Play, Square, Trash2, X } from "lucide-react";
import type { FieldOptions } from "@bibalak/ipc-types";
import { MediaFieldControls } from "@/components/editor/MediaFieldControls";
import { insertClozeIntoEditor } from "@/components/editor/useActiveFieldEditor";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { mediaUrl } from "@/lib/renderCard";
import { t } from "@/lib/i18n";
import { getCardEffectiveVolume, subscribeCardEffectiveVolume } from "@/stores/sound";
import { toast } from "@/stores/toast";
import {
  analyzeFieldMediaContent,
  appendMediaTagToHtml,
  extractImageFiles,
  extractSoundMediaFiles,
  MEDIA_PICKER_EXTENSIONS,
  removeImageRefFromHtml,
  removeSoundRefFromHtml,
  replaceImageRefInHtml,
  replaceSoundRefInHtml,
  saveImageFile,
  saveSoundMediaFile,
  toDisplayHtml,
  toStorageHtml,
  VIDEO_EXT_RE,
} from "@/lib/editorMedia";
import {
  cleanPastedHtml,
  editorHtmlExtensions,
  editorTableExtensions,
  isSafePastedUrl,
} from "@/lib/editorPaste";
import { maxClozeIndex } from "@/lib/clozeUtils";
import {
  formatStoredMediaReference,
  normalizePastedMediaPath,
  type MediaFieldKind,
} from "@/lib/noteFieldGroups";
import { isMac } from "@/lib/shortcuts";

export interface FieldEditorProps {
  id?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  value: string;
  onChange: (html: string) => void;
  /** HTML of the note's other fields, so cloze numbering stays unique across the whole note. */
  otherFieldsHtml?: string[];
  autoFocus?: boolean;
  onCtrlEnter?: () => void;
  /** Called with the TipTap `Editor` instance when this field receives focus. */
  onFocusEditor?: (editor: Editor) => void;
  /** Called with the TipTap `Editor` instance when this field unmounts/destroys. */
  onDestroyEditor?: (editor: Editor) => void;
  options?: FieldOptions;
  /** Show `options.description` as an editor placeholder when empty (Add screen). */
  showDescription?: boolean;
  /** Optional media field classification (`F11`) to use dedicated media UI & intercept dropped/pasted media. */
  mediaFieldKind?: MediaFieldKind | null;
}

type RemovedMediaState = { label: string; prevValue: string };

/**
 * Shared audio playback hook synced live to the `Card audio` volume setting (`stores/sound`).
 */
function useSyncedAudioPlayer() {
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioUnsubRef = useRef<(() => void) | null>(null);
  const [playingSound, setPlayingSound] = useState<string | null>(null);

  const stop = () => {
    audioUnsubRef.current?.();
    audioUnsubRef.current = null;
    audioPlayerRef.current?.pause();
    audioPlayerRef.current = null;
    setPlayingSound(null);
  };

  useEffect(() => stop, []);

  const toggle = (name: string) => {
    if (playingSound === name) {
      stop();
      return;
    }
    stop();
    const audio = new Audio(mediaUrl(name));
    audio.volume = getCardEffectiveVolume();
    const clearPlaying = () => {
      if (audioPlayerRef.current === audio) {
        audioUnsubRef.current?.();
        audioUnsubRef.current = null;
        audioPlayerRef.current = null;
        setPlayingSound(null);
      }
    };
    audio.onended = clearPlaying;
    audio.onerror = clearPlaying;
    audioUnsubRef.current = subscribeCardEffectiveVolume((vol) => {
      audio.volume = vol;
    });
    audioPlayerRef.current = audio;
    setPlayingSound(name);
    void Promise.resolve(audio.play()).catch(clearPlaying);
  };

  return { playingSound, toggle, stop };
}

/**
 * Rich-text / pure-media field editor. Dispatches to a clean visual media surface
 * (no raw HTML or `[sound:]` text box) for explicitly typed or media-only fields,
 * and uses TipTap for normal/mixed text fields.
 */
export function FieldEditor(props: FieldEditorProps) {
  const { value, options, mediaFieldKind } = props;
  const content = analyzeFieldMediaContent(value);
  const [removedMedia, setRemovedMedia] = useState<RemovedMediaState | null>(null);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);

  const explicitMediaKind =
    options?.kind && options.kind !== "text" ? options.kind : (mediaFieldKind ?? null);
  let pureKind: MediaFieldKind | null = null;
  if (options?.kind !== "text" && !content.hasText) {
    pureKind = explicitMediaKind ?? content.pureKind;
  }

  const handleUndoRemove = () => {
    if (!removedMedia) return;
    const prev = removedMedia.prevValue;
    setRemovedMedia(null);
    setConfirmRemoveKey(null);
    props.onChange(prev);
  };

  if (pureKind) {
    return (
      <MediaOnlyFieldSurface
        {...props}
        pureKind={pureKind}
        content={content}
        confirmRemoveKey={confirmRemoveKey}
        setConfirmRemoveKey={setConfirmRemoveKey}
        removedMedia={removedMedia}
        setRemovedMedia={setRemovedMedia}
        onUndoRemove={handleUndoRemove}
      />
    );
  }

  return (
    <RichTextFieldEditor
      {...props}
      content={content}
      confirmRemoveKey={confirmRemoveKey}
      setConfirmRemoveKey={setConfirmRemoveKey}
      removedMedia={removedMedia}
      setRemovedMedia={setRemovedMedia}
      onUndoRemove={handleUndoRemove}
    />
  );
}

interface InternalSurfaceProps extends FieldEditorProps {
  content: ReturnType<typeof analyzeFieldMediaContent>;
  confirmRemoveKey: string | null;
  setConfirmRemoveKey: (key: string | null) => void;
  removedMedia: RemovedMediaState | null;
  setRemovedMedia: (state: RemovedMediaState | null) => void;
  onUndoRemove: () => void;
}

function MediaOnlyFieldSurface({
  id,
  ariaLabelledBy,
  ariaDescribedBy,
  value,
  onChange,
  options,
  pureKind,
  content,
  confirmRemoveKey,
  setConfirmRemoveKey,
  removedMedia,
  setRemovedMedia,
  onUndoRemove,
}: InternalSurfaceProps & { pureKind: MediaFieldKind }) {
  const tauri = isTauri();
  const { playingSound, toggle, stop } = useSyncedAudioPlayer();
  const { soundRefs, imageRefs } = content;
  const fieldLabel = options?.description?.trim();
  const hasMedia = pureKind === "image" ? imageRefs.length > 0 : soundRefs.length > 0;

  const emptyHint =
    pureKind === "image"
      ? t("editor.dropImageHint")
      : pureKind === "video"
        ? t("editor.dropVideoHint")
        : t("editor.dropAudioHint");

  const savePickedFile = async (kind: MediaFieldKind, title: string): Promise<string | null> => {
    if (!tauri) {
      toast.error(t("editor.mediaRequiresDesktop"));
      return null;
    }
    const picked = await platform.pickPath({
      title,
      filters: [{ name: title, extensions: MEDIA_PICKER_EXTENSIONS[kind] }],
    });
    if (!picked) return null;
    return ipc.saveMediaFromPath(picked);
  };

  const replaceImage = async (rawSrc: string) => {
    try {
      const saved = await savePickedFile("image", t("editor.fileImage"));
      if (!saved) return;
      setRemovedMedia(null);
      setConfirmRemoveKey(null);
      onChange(replaceImageRefInHtml(value, rawSrc, saved));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const replaceSound = async (oldName: string) => {
    try {
      const title = pureKind === "video" ? t("editor.fileVideo") : t("editor.fileAudio");
      const saved = await savePickedFile(pureKind, title);
      if (!saved) return;
      if (playingSound === oldName) stop();
      setRemovedMedia(null);
      setConfirmRemoveKey(null);
      onChange(replaceSoundRefInHtml(value, oldName, saved));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const appendStoredFiles = async (data: DataTransfer | null) => {
    const images = extractImageFiles(data);
    const sounds = extractSoundMediaFiles(data);
    let next = value;
    for (const file of images) {
      try {
        const saved = await saveImageFile(file, tauri);
        next = appendMediaTagToHtml(next, formatStoredMediaReference("image", saved.alt));
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
    for (const file of sounds) {
      try {
        const saved = await saveSoundMediaFile(file, tauri);
        next = appendMediaTagToHtml(next, formatStoredMediaReference("audio", saved));
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
    if (next !== value) {
      setRemovedMedia(null);
      onChange(next);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const images = extractImageFiles(e.clipboardData);
    const sounds = extractSoundMediaFiles(e.clipboardData);
    if (images.length > 0 || sounds.length > 0) {
      e.preventDefault();
      void appendStoredFiles(e.clipboardData);
      return;
    }
    if (!tauri) return;
    const pastedPath = normalizePastedMediaPath(e.clipboardData?.getData("text/plain") ?? "");
    if (!pastedPath) return;
    e.preventDefault();
    void (async () => {
      try {
        const stored = await ipc.saveMediaFromPath(pastedPath);
        setRemovedMedia(null);
        onChange(appendMediaTagToHtml(value, formatStoredMediaReference(pureKind, stored)));
      } catch (err) {
        toast.error(errorMessage(err));
      }
    })();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    const images = extractImageFiles(e.dataTransfer);
    const sounds = extractSoundMediaFiles(e.dataTransfer);
    if (images.length === 0 && sounds.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    void appendStoredFiles(e.dataTransfer);
  };

  return (
    <div
      id={id}
      role="region"
      tabIndex={0}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      onPaste={handlePaste}
      onDragOver={(e) => {
        if (
          extractImageFiles(e.dataTransfer).length > 0 ||
          extractSoundMediaFiles(e.dataTransfer).length > 0
        ) {
          e.preventDefault();
        }
      }}
      onDrop={handleDrop}
      className="space-y-2 rounded-md border border-input bg-muted/15 p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {pureKind === "image" &&
        imageRefs.map(({ rawSrc, name }) => {
          const itemKey = `image:${rawSrc}`;
          return (
            <div
              key={rawSrc}
              data-image-chip={name}
              className="overflow-hidden rounded-md border border-border bg-background"
            >
              <div className="flex max-h-44 min-h-20 w-full items-center justify-center bg-muted/20 p-1.5">
                <img
                  src={mediaUrl(name)}
                  alt={name}
                  className="max-h-40 max-w-full rounded-sm object-contain"
                />
              </div>
              <div className="flex min-w-0 items-center gap-2 border-t border-border/60 px-2 py-1 text-xs">
                <span
                  dir="ltr"
                  title={name}
                  className="min-w-0 flex-1 truncate font-medium text-foreground"
                >
                  {name}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void replaceImage(rawSrc)}
                    aria-label={t("editor.replaceMedia", { name })}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("editor.replace")}
                  </button>
                  <MediaRemoveControl
                    confirming={confirmRemoveKey === itemKey}
                    removeLabel={t("editor.removeMedia", { name })}
                    onStartConfirm={() => setConfirmRemoveKey(itemKey)}
                    onConfirm={() => {
                      setConfirmRemoveKey(null);
                      setRemovedMedia({ label: name, prevValue: value });
                      onChange(removeImageRefFromHtml(value, rawSrc));
                    }}
                    onCancel={() => setConfirmRemoveKey(null)}
                  />
                </div>
              </div>
            </div>
          );
        })}

      {pureKind !== "image" &&
        soundRefs.map((name) => {
          const itemKey = `sound:${name}`;
          const isVideo = pureKind === "video" || VIDEO_EXT_RE.test(name);
          return (
            <div
              key={name}
              data-sound-chip={name}
              className="overflow-hidden rounded-md border border-border bg-background"
            >
              {isVideo && (
                <div className="flex max-h-44 w-full items-center justify-center bg-black/80 p-1">
                  <video
                    controls
                    preload="metadata"
                    src={mediaUrl(name)}
                    className="max-h-40 max-w-full rounded-sm"
                  />
                </div>
              )}
              <div className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-xs">
                {!isVideo && (
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    aria-label={
                      playingSound === name
                        ? t("editor.stopMedia", { name })
                        : t("editor.playMedia", { name })
                    }
                    className="flex size-6 shrink-0 items-center justify-center rounded text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {playingSound === name ? (
                      <Square className="size-3 fill-current" aria-hidden="true" />
                    ) : (
                      <Play className="size-3 fill-current" aria-hidden="true" />
                    )}
                  </button>
                )}
                <span dir="ltr" title={name} className="min-w-0 flex-1 truncate text-foreground">
                  {name}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void replaceSound(name)}
                    aria-label={t("editor.replaceMedia", { name })}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("editor.replace")}
                  </button>
                  <MediaRemoveControl
                    confirming={confirmRemoveKey === itemKey}
                    removeLabel={t("editor.removeMedia", { name })}
                    onStartConfirm={() => setConfirmRemoveKey(itemKey)}
                    onConfirm={() => {
                      if (playingSound === name) stop();
                      setConfirmRemoveKey(null);
                      setRemovedMedia({ label: name, prevValue: value });
                      onChange(removeSoundRefFromHtml(value, name));
                    }}
                    onCancel={() => setConfirmRemoveKey(null)}
                  />
                </div>
              </div>
            </div>
          );
        })}

      {!hasMedia && (
        <div className="space-y-2 rounded border border-dashed border-border/80 bg-background/60 p-2.5">
          <p className="text-xs text-muted-foreground">{fieldLabel || emptyHint}</p>
          <MediaFieldControls
            kind={pureKind}
            fieldLabel={fieldLabel || pureKind}
            value={value}
            onChange={(next) => {
              setRemovedMedia(null);
              onChange(next);
            }}
            tauri={tauri}
          />
        </div>
      )}

      {removedMedia && (
        <RemovedMediaBanner
          label={removedMedia.label}
          onUndo={onUndoRemove}
          onDismiss={() => setRemovedMedia(null)}
        />
      )}
    </div>
  );
}

function RichTextFieldEditor({
  id,
  ariaLabelledBy,
  ariaDescribedBy,
  value,
  onChange,
  otherFieldsHtml,
  autoFocus,
  onCtrlEnter,
  onFocusEditor,
  onDestroyEditor,
  options,
  showDescription,
  mediaFieldKind,
  content,
  confirmRemoveKey,
  setConfirmRemoveKey,
  removedMedia,
  setRemovedMedia,
  onUndoRemove,
}: InternalSurfaceProps) {
  const tauri = isTauri();
  const dir = options?.direction ?? "auto";
  const font = options?.font?.trim() || undefined;
  const fontSize = options?.size && options.size > 0 ? `${options.size}px` : undefined;
  const placeholder = showDescription ? options?.description?.trim() || undefined : undefined;
  const editorStyle = [font ? `font-family: ${font}` : "", fontSize ? `font-size: ${fontSize}` : ""]
    .filter(Boolean)
    .join("; ");

  const nextCloze = maxClozeIndex([...(otherFieldsHtml ?? []), value]) + 1;
  const lastCloze = Math.max(1, nextCloze - 1);
  const clozeRangeRef = useRef({ next: nextCloze, last: lastCloze });
  clozeRangeRef.current = { next: nextCloze, last: lastCloze };

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const lastLoadedValueRef = useRef<string>(value);
  const emittedHtmlQueueRef = useRef<string[]>([]);
  const onFocusEditorRef = useRef(onFocusEditor);
  onFocusEditorRef.current = onFocusEditor;
  const onDestroyEditorRef = useRef(onDestroyEditor);
  onDestroyEditorRef.current = onDestroyEditor;
  const { playingSound, toggle: togglePlaySound, stop: stopAudioPlayer } = useSyncedAudioPlayer();
  const [plainTextMode, setPlainTextMode] = useState(false);

  const { soundRefs, imageRefs } = content;

  const removeSoundRef = (name: string) => {
    if (playingSound === name) stopAudioPlayer();
    setConfirmRemoveKey(null);
    setRemovedMedia({ label: name, prevValue: value });
    onChange(removeSoundRefFromHtml(value, name));
  };

  const removeImageRef = (rawSrc: string, name: string) => {
    setConfirmRemoveKey(null);
    setRemovedMedia({ label: name, prevValue: value });
    onChange(removeImageRefFromHtml(value, rawSrc));
  };

  const replaceImageRef = async (rawSrc: string) => {
    if (!tauri) {
      toast.error(t("editor.mediaRequiresDesktop"));
      return;
    }
    try {
      const picked = await platform.pickPath({
        filters: [{ name: t("editor.fileImage"), extensions: MEDIA_PICKER_EXTENSIONS.image }],
      });
      if (!picked) return;
      const saved = await ipc.saveMediaFromPath(picked);
      setRemovedMedia(null);
      onChange(replaceImageRefInHtml(value, rawSrc, saved));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const insertImageFiles = (files: File[], insertPos?: number) => {
    void (async () => {
      for (const file of files) {
        try {
          const saved = await saveImageFile(file, tauri);
          const currentEditor = editorRef.current;
          if (!currentEditor || currentEditor.isDestroyed) return;
          const chain = currentEditor.chain().focus();
          if (insertPos !== undefined) {
            chain.insertContentAt(insertPos, { type: "image", attrs: saved }).run();
          } else {
            chain.setImage(saved).run();
          }
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }
    })();
  };

  const insertSoundFiles = (files: File[], insertPos?: number) => {
    void (async () => {
      for (const file of files) {
        try {
          const saved = await saveSoundMediaFile(file, tauri);
          const currentEditor = editorRef.current;
          if (!currentEditor || currentEditor.isDestroyed) return;
          const chain = currentEditor.chain().focus();
          const node = { type: "text", text: `[sound:${saved}]` };
          if (insertPos !== undefined) {
            chain.insertContentAt(insertPos, node).run();
          } else {
            chain.insertContent(node).run();
          }
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }
    })();
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: false,
          isAllowedUri: (url) => isSafePastedUrl(url, "link"),
        },
      }),
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      Image,
      ...editorHtmlExtensions,
      ...editorTableExtensions,
    ],
    content: toDisplayHtml(value, tauri),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        class: "keepsake-prose min-h-[2.5rem] px-2.5 py-1.5 outline-none",
        dir,
        ...(id ? { id } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        ...(editorStyle ? { style: editorStyle } : {}),
      },
      transformPastedHTML: cleanPastedHtml,
      handlePaste: (_view, event) => {
        const images = extractImageFiles(event.clipboardData);
        const sounds = extractSoundMediaFiles(event.clipboardData);
        if (images.length > 0 || sounds.length > 0) {
          event.preventDefault();
          if (images.length > 0) insertImageFiles(images);
          if (sounds.length > 0) insertSoundFiles(sounds);
          return true;
        }
        if (mediaFieldKind && tauri) {
          const pastedPath = normalizePastedMediaPath(
            event.clipboardData?.getData("text/plain") ?? "",
          );
          if (pastedPath) {
            event.preventDefault();
            void (async () => {
              try {
                const stored = await ipc.saveMediaFromPath(pastedPath);
                const currentEditor = editorRef.current;
                if (!currentEditor || currentEditor.isDestroyed) return;
                if (mediaFieldKind === "image") {
                  currentEditor
                    .chain()
                    .focus()
                    .setImage({ src: mediaUrl(stored), alt: stored })
                    .run();
                } else {
                  currentEditor
                    .chain()
                    .focus()
                    .insertContent({ type: "text", text: `[sound:${stored}]` })
                    .run();
                }
              } catch (err) {
                toast.error(errorMessage(err));
              }
            })();
            return true;
          }
        }
        return false;
      },
      handleDOMEvents: {
        drop: (view, event) => {
          const images = extractImageFiles(event.dataTransfer);
          const sounds = extractSoundMediaFiles(event.dataTransfer);
          if (images.length === 0 && sounds.length === 0) return false;
          event.preventDefault();
          event.stopPropagation();
          const coords =
            typeof document.elementFromPoint === "function"
              ? view.posAtCoords({ left: event.clientX, top: event.clientY })
              : null;
          if (images.length > 0) insertImageFiles(images, coords?.pos);
          if (sounds.length > 0) insertSoundFiles(sounds, coords?.pos);
          return true;
        },
      },
      handleKeyDown: (_view, event) => {
        const mod = isMac() ? event.metaKey : event.ctrlKey;
        if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
          event.preventDefault();
          const currentEditor = editorRef.current;
          if (currentEditor) {
            insertClozeIntoEditor(
              currentEditor,
              event.altKey ? clozeRangeRef.current.last : clozeRangeRef.current.next,
            );
          }
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          onCtrlEnter?.();
          return true;
        }
        return false;
      },
    },
    onFocus: ({ editor }) => onFocusEditorRef.current?.(editor),
    onDestroy: () => {
      if (editorRef.current) onDestroyEditorRef.current?.(editorRef.current);
    },
    onUpdate: ({ editor, transaction }) => {
      if (!transaction.docChanged) return;
      setConfirmRemoveKey(null);
      setRemovedMedia(null);
      const html = toStorageHtml(editor.getHTML());
      emittedHtmlQueueRef.current.push(html);
      lastLoadedValueRef.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    return () => {
      if (editorRef.current) onDestroyEditorRef.current?.(editorRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    dom.setAttribute("dir", dir);
    dom.style.fontFamily = font ?? "";
    dom.style.fontSize = fontSize ?? "";
  }, [editor, dir, font, fontSize]);

  useEffect(() => {
    if (!editor) return;
    const echoIdx = emittedHtmlQueueRef.current.indexOf(value);
    if (echoIdx !== -1) {
      emittedHtmlQueueRef.current.splice(0, echoIdx + 1);
      lastLoadedValueRef.current = value;
      return;
    }
    emittedHtmlQueueRef.current.length = 0;
    if (value === lastLoadedValueRef.current) return;
    lastLoadedValueRef.current = value;
    const current = toStorageHtml(editor.getHTML());
    if (value !== current) {
      editor.commands.setContent(toDisplayHtml(value, tauri), { emitUpdate: false });
    }
  }, [value, editor, tauri]);

  useEffect(() => {
    if (autoFocus && editor) {
      editor.commands.focus("end");
    }
  }, [autoFocus, editor]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background text-sm focus-within:ring-2 focus-within:ring-ring">
      <div className="relative">
        {placeholder && editor.isEmpty && !plainTextMode && (
          <div
            aria-hidden="true"
            dir={dir}
            style={{ fontFamily: font, fontSize }}
            className="pointer-events-none absolute inset-x-2.5 top-1.5 select-none text-muted-foreground/60"
          >
            {placeholder}
          </div>
        )}
        {plainTextMode ? (
          <textarea
            dir="ltr"
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            className="min-h-[4.5rem] w-full resize-y bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>

      {(soundRefs.length > 0 ||
        imageRefs.length > 0 ||
        removedMedia !== null ||
        value.includes("<")) && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 bg-muted/20 p-2">
          {soundRefs.map((name) => {
            const isPlaying = playingSound === name;
            const itemKey = `sound:${name}`;
            return (
              <div
                key={name}
                data-sound-chip={name}
                className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => togglePlaySound(name)}
                  aria-label={
                    isPlaying ? t("editor.stopMedia", { name }) : t("editor.playMedia", { name })
                  }
                  className="flex size-6 shrink-0 items-center justify-center rounded text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {isPlaying ? (
                    <Square className="size-3 fill-current" aria-hidden="true" />
                  ) : (
                    <Play className="size-3 fill-current" aria-hidden="true" />
                  )}
                </button>
                <span dir="ltr" title={name} className="min-w-0 flex-1 truncate text-foreground">
                  {name}
                </span>
                <MediaRemoveControl
                  confirming={confirmRemoveKey === itemKey}
                  removeLabel={t("editor.removeMedia", { name })}
                  onStartConfirm={() => setConfirmRemoveKey(itemKey)}
                  onConfirm={() => removeSoundRef(name)}
                  onCancel={() => setConfirmRemoveKey(null)}
                />
              </div>
            );
          })}
          {imageRefs.map(({ rawSrc, name }) => {
            const itemKey = `image:${rawSrc}`;
            return (
              <div
                key={rawSrc}
                data-image-chip={name}
                className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background p-1.5 text-xs"
              >
                <div className="flex h-8 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-muted/40">
                  <img
                    src={mediaUrl(name)}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <span
                  dir="auto"
                  title={t("editor.imageLabel", { name })}
                  className="min-w-0 flex-1 truncate text-foreground"
                >
                  {t("editor.imageLabel", { name })}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void replaceImageRef(rawSrc)}
                    aria-label={t("editor.replaceMedia", { name })}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("editor.replace")}
                  </button>
                  <MediaRemoveControl
                    confirming={confirmRemoveKey === itemKey}
                    removeLabel={t("editor.removeMedia", { name })}
                    onStartConfirm={() => setConfirmRemoveKey(itemKey)}
                    onConfirm={() => removeImageRef(rawSrc, name)}
                    onCancel={() => setConfirmRemoveKey(null)}
                  />
                </div>
              </div>
            );
          })}
          {removedMedia && (
            <RemovedMediaBanner
              label={removedMedia.label}
              onUndo={onUndoRemove}
              onDismiss={() => setRemovedMedia(null)}
            />
          )}
          {value.includes("<") && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPlainTextMode((v) => !v)}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                {plainTextMode ? t("editor.showRichText") : t("editor.showPlainText")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RemovedMediaBanner({
  label,
  onUndo,
  onDismiss,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-2 py-1 text-xs"
    >
      <span className="min-w-0 truncate text-muted-foreground" title={label}>
        {t("editor.removedMedia", { name: label })}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onUndo}
          className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("decks.undo")}
        </button>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onDismiss}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function MediaRemoveControl({
  confirming,
  removeLabel,
  onStartConfirm,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  removeLabel: string;
  onStartConfirm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("editor.confirmRemoveMedia")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("common.cancel")}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onStartConfirm}
      aria-label={removeLabel}
      title={removeLabel}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
    </button>
  );
}
