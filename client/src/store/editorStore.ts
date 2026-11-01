import { create } from "zustand";
import { api, type TextFile } from "../lib/api";
export interface EditorDocument extends TextFile {
  repo: string;
  file: string;
  baseContent: string;
  loading: boolean;
  loaded: boolean;
  saving: boolean;
  external: boolean;
  error: string;
  token: number;
}
interface EditorState {
  documents: Record<string, EditorDocument>;
  selected: Record<string, string>;
  open: (repo: string, file: string) => Promise<void>;
  reload: (key: string) => Promise<void>;
  change: (key: string, content: string) => void;
  save: (key: string) => Promise<boolean>;
  check: (key: string) => Promise<void>;
  close: (key: string) => void;
}
export const documentKey = (repo: string, file: string) =>
  JSON.stringify([repo, file]);
export const isDirty = (doc: EditorDocument) =>
  doc.loaded && doc.content !== doc.baseContent;
let token = 0;
export const useEditorStore = create<EditorState>()((set, get) => ({
  documents: {},
  selected: {},
  open: async (repo, file) => {
    const key = documentKey(repo, file);
    if (!get().documents[key] && Object.keys(get().documents).length >= 30)
      throw new Error(
        "Close an editor tab before opening more files (30 tab limit).",
      );
    set((s) => ({ selected: { ...s.selected, [repo]: key } }));
    if (get().documents[key]) return;
    const doc: EditorDocument = {
      repo,
      file,
      content: "",
      baseContent: "",
      revision: "",
      lineEnding: "lf",
      loading: false,
      loaded: false,
      saving: false,
      external: false,
      error: "",
      token: ++token,
    };
    set((s) => ({ documents: { ...s.documents, [key]: doc } }));
    await get().reload(key);
  },
  reload: async (key) => {
    const doc = get().documents[key];
    if (!doc || doc.saving || doc.loading) return;
    const requestToken = ++token;
    set((s) => ({
      documents: {
        ...s.documents,
        [key]: { ...doc, loading: true, token: requestToken, error: "" },
      },
    }));
    try {
      const file = await api.editorRead(doc.repo, doc.file);
      if (get().documents[key]?.token !== requestToken) return;
      set((s) => ({
        documents: {
          ...s.documents,
          [key]: {
            ...s.documents[key],
            ...file,
            baseContent: file.content,
            loading: false,
            loaded: true,
            external: false,
            error: "",
          },
        },
      }));
    } catch (e: any) {
      if (get().documents[key]?.token !== requestToken) return;
      set((s) => ({
        documents: {
          ...s.documents,
          [key]: { ...s.documents[key], loading: false, error: e.message },
        },
      }));
    }
  },
  change: (key, content) =>
    set((s) =>
      s.documents[key]
        ? {
            documents: {
              ...s.documents,
              [key]: { ...s.documents[key], content },
            },
          }
        : {},
    ),
  save: async (key) => {
    const doc = get().documents[key];
    if (
      !doc?.loaded ||
      doc.saving ||
      doc.loading ||
      doc.external ||
      !isDirty(doc)
    )
      return false;
    set((s) => ({
      documents: {
        ...s.documents,
        [key]: { ...s.documents[key], saving: true, error: "" },
      },
    }));
    try {
      const saved = await api.editorSave(
        doc.repo,
        doc.file,
        doc.content,
        doc.revision,
      );
      const current = get().documents[key];
      if (!current) return true;
      set((s) => ({
        documents: {
          ...s.documents,
          [key]: {
            ...s.documents[key],
            revision: saved.revision,
            baseContent: saved.content,
            saving: false,
            external: false,
            error: "",
          },
        },
      }));
      return true;
    } catch (e: any) {
      if (get().documents[key])
        set((s) => ({
          documents: {
            ...s.documents,
            [key]: {
              ...s.documents[key],
              saving: false,
              external: e.status === 409 || s.documents[key].external,
              error: e.message,
            },
          },
        }));
      return false;
    }
  },
  check: async (key) => {
    const doc = get().documents[key];
    if (!doc?.loaded || doc.loading || doc.saving) return;
    try {
      const latest = await api.editorRevision(doc.repo, doc.file);
      const current = get().documents[key];
      if (
        !current ||
        current.loading ||
        current.saving ||
        current.revision !== doc.revision
      )
        return;
      if (latest.revision !== current.revision)
        set((s) => ({
          documents: {
            ...s.documents,
            [key]: { ...s.documents[key], external: true },
          },
        }));
    } catch {
      const current = get().documents[key];
      if (current && !current.saving && !current.loading)
        set((s) => ({
          documents: {
            ...s.documents,
            [key]: {
              ...s.documents[key],
              external: true,
              error:
                "The server file is unavailable or no longer editable. Your draft is kept.",
            },
          },
        }));
    }
  },
  close: (key) =>
    set((s) => {
      const doc = s.documents[key];
      if (!doc || doc.saving || doc.loading) return {};
      const documents = { ...s.documents };
      delete documents[key];
      const selected = { ...s.selected };
      if (selected[doc.repo] === key)
        selected[doc.repo] =
          Object.keys(documents)
            .filter((k) => documents[k].repo === doc.repo)
            .at(-1) || "";
      return { documents, selected };
    }),
}));
