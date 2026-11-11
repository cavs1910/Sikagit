import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { basicSetup, EditorView } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { useEditorStore } from "../../store/editorStore";
import type { EditorDocument } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { EditorToolbar } from "./EditorToolbar";

function appearance(fontSize: number, wordWrap: boolean): Extension {
  return [
    EditorView.theme({ ".cm-scroller": { fontSize: `${fontSize}px` } }),
    wordWrap ? EditorView.lineWrapping : [],
  ];
}

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
  toolbarContainer,
  onReload,
}: {
  documentKey: string;
  doc: EditorDocument;
  onSave: () => void;
  toolbarContainer: HTMLElement | null;
  onReload: () => void;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    save = useRef(onSave);
  save.current = onSave;
  const fontSize = useUIStore((s) => s.editorFontSize);
  const wordWrap = useUIStore((s) => s.editorWordWrap);
  const display = useRef(new Compartment());
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
          display.current.of(
            appearance(
              useUIStore.getState().editorFontSize,
              useUIStore.getState().editorWordWrap,
            ),
          ),
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
  useEffect(() => {
    view.current?.dispatch({ effects: display.current.reconfigure(appearance(fontSize, wordWrap)) });
  }, [fontSize, wordWrap]);
  return (
    <>
      {toolbarContainer && createPortal(
        <EditorToolbar
          onReload={onReload}
          canReload={!doc.loading && !doc.saving}
          onCommand={(command) => {
            const editor = view.current;
            if (editor) {
              editor.focus();
              command(editor);
            }
          }}
        />,
        toolbarContainer,
      )}
      <div ref={parent} className="code-editor flex-1 min-h-0 overflow-hidden" />
    </>
  );
}
