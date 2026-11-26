import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Tracks the currently focused (or last-focused) TipTap `Editor` across a
 * note editor screen so a single shared `EditorToolbar` can format it.
 * Does not clear on blur so toolbar interactions keep targeting the last
 * focused field; clears only when that editor instance is destroyed.
 */
export function useActiveFieldEditor() {
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);

  const onFocusEditor = useCallback((editor: Editor) => {
    setActiveEditor(editor);
  }, []);

  const onDestroyEditor = useCallback((editor: Editor) => {
    setActiveEditor((current) => (current === editor ? null : current));
  }, []);

  const liveEditor = activeEditor && !activeEditor.isDestroyed ? activeEditor : null;

  return { activeEditor: liveEditor, onFocusEditor, onDestroyEditor };
}

/** Inserts a cloze deletion marker `{{cN::…}}` around the current selection in `editor`. */
export function insertClozeIntoEditor(editor: Editor, index: number) {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const text = empty ? "…" : state.doc.textBetween(from, to);
  editor.chain().focus().insertContent(`{{c${index}::${text}}}`).run();
}
