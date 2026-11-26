import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";
import type { FieldOptions } from "@bibalak/ipc-types";
import { insertClozeIntoEditor } from "@/components/editor/useActiveFieldEditor";
import { isTauri } from "@/lib/ipc";
import { extractImageFiles, saveImageFile, toDisplayHtml, toStorageHtml } from "@/lib/editorMedia";
import { cleanPastedHtml, editorTableExtensions, isSafePastedUrl } from "@/lib/editorPaste";
import { maxClozeIndex } from "@/lib/clozeUtils";
import { isMac } from "@/lib/shortcuts";

/**
 * Rich-text editor for a single note field. Edits HTML in place; `onChange`
 * fires with the field's current HTML. Remount (via a React key) to load a
 * different field's content — the initial value is only read on mount.
 */
export function FieldEditor({
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
}: {
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
}) {
  const tauri = isTauri();
  const dir = options?.direction ?? "auto";
  const font = options?.font?.trim() || undefined;
  const fontSize = options?.size && options.size > 0 ? `${options.size}px` : undefined;
  const placeholder = showDescription ? options?.description?.trim() || undefined : undefined;
  const editorStyle = [font ? `font-family: ${font}` : "", fontSize ? `font-size: ${fontSize}` : ""]
    .filter(Boolean)
    .join("; ");

  // Recomputed on every render (cheap regex scans) so keyboard cloze insertion
  // always proposes the next free index across the whole note.
  const nextCloze = maxClozeIndex([...(otherFieldsHtml ?? []), value]) + 1;
  const lastCloze = Math.max(1, nextCloze - 1);
  const clozeRangeRef = useRef({ next: nextCloze, last: lastCloze });
  clozeRangeRef.current = { next: nextCloze, last: lastCloze };

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const emittedHtmlQueueRef = useRef<string[]>([]);
  const onFocusEditorRef = useRef(onFocusEditor);
  onFocusEditorRef.current = onFocusEditor;
  const onDestroyEditorRef = useRef(onDestroyEditor);
  onDestroyEditorRef.current = onDestroyEditor;

  const insertImageFiles = (files: File[], insertPos?: number) => {
    void (async () => {
      for (const file of files) {
        const saved = await saveImageFile(file, tauri);
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) return;
        const chain = currentEditor.chain().focus();
        if (insertPos !== undefined) {
          chain.insertContentAt(insertPos, { type: "image", attrs: saved }).run();
        } else {
          chain.setImage(saved).run();
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
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      Image,
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
        if (images.length === 0) return false;
        event.preventDefault();
        insertImageFiles(images);
        return true;
      },
      handleDOMEvents: {
        drop: (view, event) => {
          const images = extractImageFiles(event.dataTransfer);
          if (images.length === 0) return false;
          event.preventDefault();
          event.stopPropagation();
          const coords =
            typeof document.elementFromPoint === "function"
              ? view.posAtCoords({ left: event.clientX, top: event.clientY })
              : null;
          insertImageFiles(images, coords?.pos);
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
    onUpdate: ({ editor }) => {
      const html = toStorageHtml(editor.getHTML());
      emittedHtmlQueueRef.current.push(html);
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
      return;
    }
    emittedHtmlQueueRef.current.length = 0;
    const current = toStorageHtml(editor.getHTML());
    if (value !== current) {
      editor.commands.setContent(toDisplayHtml(value, tauri));
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
        {placeholder && editor.isEmpty && (
          <div
            aria-hidden="true"
            dir={dir}
            style={{ fontFamily: font, fontSize }}
            className="pointer-events-none absolute inset-x-2.5 top-1.5 select-none text-muted-foreground/60"
          >
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
