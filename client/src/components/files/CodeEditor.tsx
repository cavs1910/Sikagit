import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { useEditorStore } from "../../store/editorStore";
import type { EditorDocument } from "../../store/editorStore";

async function language(file: string): Promise<Extension> {
  const ext = file.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "ts":
    case "tsx": {
      const m = await import("@codemirror/lang-javascript");
      return m.javascript({
        typescript: ext === "ts" || ext === "tsx",
        jsx: ext === "jsx" || ext === "tsx",
      });
    }
    case "json":
    case "jsonc":
      return (await import("@codemirror/lang-json")).json();
    case "md":
    case "mdx":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    default:
      return [];
  }
}
export default function CodeEditor({
  documentKey,
  doc,
  onSave,
}: {
  documentKey: string;
  doc: EditorDocument;
  onSave: () => void;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    if (!parent.current) return;
    const syntax = new Compartment();
    let cancelled = false;
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: doc.content,
        extensions: [
          basicSetup,
          EditorState.lineSeparator.of(
            doc.lineEnding === "crlf" ? "\r\n" : "\n",
          ),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                save.current();
                return true;
              },
            },
            indentWithTab,
          ]),
          syntax.of([]),
          EditorView.contentAttributes.of({
            "aria-label": "File editor",
            spellcheck: "false",
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "13px",
              },
              ".cm-gutters": {
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-muted)",
                borderColor: "var(--color-border)",
              },
              ".cm-content": { caretColor: "var(--color-text-primary)" },
              ".cm-activeLine": { backgroundColor: "var(--color-bg-tertiary)" },
              ".cm-activeLineGutter": {
                backgroundColor: "var(--color-bg-tertiary)",
              },
              ".cm-panels": {
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
              },
              ".cm-searchMatch": { backgroundColor: "#a88b3550" },
              ".cm-selectionBackground": {
                backgroundColor: "#5473b455 !important",
              },
            },
            { dark: true },
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              useEditorStore
                .getState()
                .change(documentKey, update.state.sliceDoc());
          }),
        ],
      }),
    });
    view.current = editor;
    Promise.all([language(doc.file), import("@codemirror/theme-one-dark")])
      .then(([lang, theme]) => {
        if (!cancelled)
          editor.dispatch({
            effects: syntax.reconfigure([
              lang,
              syntaxHighlighting(theme.oneDarkHighlightStyle),
            ]),
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      view.current = null;
      editor.destroy();
    };
    // Recreate on file/reload, preserving normal keystroke updates and undo history.
  }, [documentKey, doc.token]);
  return <div ref={parent} className="flex-1 min-h-0 overflow-hidden" />;
}
