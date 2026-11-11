import { useUIStore } from '../../store/uiStore';
import { useMobile } from '../../hooks/useMobile';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  PanelLeftOpen,
  PanelLeftClose,
  RefreshCw,
  Save,
  X,
  Search,
  AlertTriangle,
  Loader2,
  Copy,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { api, type DirectoryEntry } from "../../lib/api";
import { useEditorStore, isDirty } from "../../store/editorStore";
import { useConfirmStore } from "../../store/confirmStore";
import { useStatusStore } from "../../store/statusStore";
import { useRepoStatusStore } from "../../store/repoStatusStore";
import { useRepoStore } from "../../store/repoStore";
import { useToastStore } from "../../store/toastStore";
import { cn } from "../../lib/utils";
import { ResizeHandle } from "../ui/ResizeHandle";
const CodeEditor = lazy(() => import("./CodeEditor"));
function Directory({
  repo,
  directory,
  showIgnored,
  refresh,
  depth,
  filter,
}: {
  repo: string;
  directory: string;
  showIgnored: boolean;
  refresh: number;
  depth: number;
  filter: string;
}) {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]),
    [opened, setOpened] = useState<Set<string>>(new Set()),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const selected = useEditorStore((s) => s.selected[repo]);
  const open = useEditorStore((s) => s.open);
  const toast = useToastStore((s) => s.addToast);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .editorTree(repo, directory, showIgnored)
      .then((items) => {
        if (!cancelled) setEntries(items);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, directory, showIgnored, refresh]);
  if (loading)
    return <div className="p-2 text-xs text-text-muted">Loading…</div>;
  if (error)
    return (
      <p role="alert" className="p-2 text-xs text-danger">
        {error}
      </p>
    );
  if (!entries.length)
    return <p className="px-3 py-2 text-xs text-text-muted">Empty folder</p>;
  return (
    <div>
      {entries
        .filter(
          (entry) =>
            entry.type === "directory" ||
            !filter ||
            entry.name.toLowerCase().includes(filter.toLowerCase()),
        )
        .map((entry) => (
          <div key={entry.path}>
            <button
              title={
                entry.type === "blocked"
                  ? "Symlinks and special files are not editable"
                  : entry.path
              }
              disabled={entry.type === "blocked"}
              onClick={() =>
                entry.type === "directory"
                  ? setOpened((previous) => {
                      const next = new Set(previous);
                      next.has(entry.path)
                        ? next.delete(entry.path)
                        : next.add(entry.path);
                      return next;
                    })
                  : void open(repo, entry.path).catch((e) =>
                      toast("error", e.message),
                    )
              }
              className={cn(
                "w-full flex items-center gap-1.5 py-1.5 pr-2 text-xs text-left hover:bg-bg-tertiary disabled:opacity-40",
                selected === JSON.stringify([repo, entry.path]) &&
                  "bg-accent/10 text-accent",
              )}
              style={{ paddingLeft: 10 + depth * 14 }}
            >
              {entry.type === "directory" ? (
                opened.has(entry.path) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {entry.type === "directory" ? (
                <Folder size={14} className="text-accent shrink-0" />
              ) : (
                <FileText size={14} className="text-text-muted shrink-0" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.type === "directory" && opened.has(entry.path) && (
              <Directory
                repo={repo}
                directory={entry.path}
                showIgnored={showIgnored}
                refresh={refresh}
                depth={depth + 1}
                filter={filter}
              />
            )}
          </div>
        ))}
    </div>
  );
}
export function FilesWorkspace({
  repoPath,
  visible,
}: {
  repoPath: string;
  visible: boolean;
}) {
  const mobile = useMobile();
  const { documents, selected, open, reload, save, check, close } =
    useEditorStore();
  const key = selected[repoPath] || "";
  const doc = documents[key];
  const tabs = Object.entries(documents).filter(
    ([, item]) => item.repo === repoPath,
  );
  const showIgnored = useUIStore(s => s.showIgnoredFiles);
  const explorerWidth = useUIStore(s => s.explorerWidth);
  const setExplorerWidth = useUIStore(s => s.setExplorerWidth);
  const explorerRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const handleExplorerResize = useCallback((delta: number) => {
    if (explorerRef.current) {
      setExplorerWidth(explorerRef.current.getBoundingClientRect().width + delta);
    }
  }, [setExplorerWidth]);
  const [refresh, setRefresh] = useState(0),
    [filter, setFilter] = useState(""),
    [showTree, setShowTree] = useState(true);
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!visible || !key) setFocused(false);
  }, [visible, key]);
  useEffect(() => {
    if (!focused) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !useConfirmStore.getState().options) setFocused(false);
    };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [focused]);
  const treeVisible = showTree || (mobile && !doc);
  useEffect(() => { if (mobile && visible) setShowTree(!key); }, [mobile, key, visible]);
  useEffect(() => {
    if (!mobile || !visible || !key || treeVisible) return;
    const scroll = workspaceRef.current?.closest('.mobile-files-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [mobile, visible, key, treeVisible]);
  const confirm = useConfirmStore((s) => s.confirm),
    toast = useToastStore((s) => s.addToast);
  const saveCurrent = useCallback(async () => {
    if (!key) return;
    const before = useEditorStore.getState().documents[key];
    if (!before || !isDirty(before)) return;
    if (await save(key)) {
      toast("success", "Saved " + before.file);
      if (useRepoStore.getState().activeRepo()?.path === before.repo)
        void useStatusStore.getState().fetchStatus(before.repo);
      const repo = useRepoStore
        .getState()
        .repos.find((r) => r.path === before.repo);
      if (repo) void useRepoStatusStore.getState().forceRefreshOne(repo);
    }
  }, [key, save, toast]);
  useEffect(() => {
    if (!visible || !key) return;
    const poll = () => {
      if (!document.hidden) void check(key);
    };
    poll();
    const timer = window.setInterval(poll, 6000);
    window.addEventListener("focus", poll);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [visible, key, check]);
  const reloadCurrent = async () => {
    if (!doc || doc.loading || doc.saving) return;
    if (
      isDirty(doc) &&
      !(await confirm({
        title: "Reload file?",
        message:
          "Discard your unsaved draft and load the current file from the server?",
        confirmLabel: "Discard draft and reload",
        variant: "warning",
      }))
    )
      return;
    void reload(key);
  };
  const closeTab = async (tabKey: string) => {
    const target = documents[tabKey];
    if (target.loading || target.saving) return;
    if (
      isDirty(target) &&
      !(await confirm({
        title: "Close unsaved file?",
        message: "Your changes have not been saved to the server.",
        confirmLabel: "Discard draft",
        variant: "warning",
      }))
    )
      return;
    close(tabKey);
  };
  return (
    <div
      ref={workspaceRef}
      role={focused ? "dialog" : undefined}
      aria-modal={focused ? true : undefined}
      aria-label={focused ? "Expanded file editor" : undefined}
      className={cn("files-workspace flex flex-1 min-h-0 overflow-hidden", focused && "editor-expanded")}
      onKeyDown={(event) => {
        if (!focused || event.key !== 'Tab' || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )).filter((item) => item.getClientRects().length > 0);
        const next = event.shiftKey && event.target === items[0] ? items.at(-1)
          : !event.shiftKey && event.target === items.at(-1) ? items[0] : null;
        if (next) { event.preventDefault(); next.focus(); }
      }}
    >
      <aside
        ref={explorerRef}
        style={{ width: mobile ? undefined : explorerWidth }}
        className={cn(
          "shrink-0 flex-col bg-bg-secondary",
          mobile ? "w-full border-r border-border" : "max-w-[60%]",
          treeVisible ? "flex" : "hidden",
        )}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold">EXPLORER</span>
          {mobile && doc && <button aria-label="Hide explorer" onClick={() => setShowTree(false)} className="p-2"><PanelLeftClose size={16} /></button>}
          <button
            title="Refresh file tree"
            onClick={() => setRefresh((n) => n + 1)}
            className="p-1 text-text-muted hover:text-text-primary"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <label className="flex items-center gap-2 px-3 py-2 border-b border-border text-text-muted">
          <Search size={13} />
          <input
            aria-label="Filter filenames in expanded folders"
            placeholder="Filter filenames…"
            className="min-w-0 w-full bg-transparent text-xs outline-none"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="flex-1 overflow-auto">
          <Directory
            key={repoPath}
            repo={repoPath}
            directory=""
            showIgnored={showIgnored}
            refresh={refresh}
            depth={0}
            filter={filter}
          />
        </div>
      </aside>
      {!mobile && treeVisible && (
        <ResizeHandle direction="horizontal" onResize={handleExplorerResize} />
      )}
      {(!mobile || (!!doc && !treeVisible)) && <section aria-label="File editor workspace" className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <div className="editor-tabbar flex items-stretch border-b border-border bg-bg-secondary min-w-0 shrink-0">
          <button
            title={treeVisible ? "Hide explorer" : "Show explorer"}
            aria-expanded={treeVisible}
            onClick={() => setShowTree((value) => !value)}
            className="editor-icon-button shrink-0"
          >
            {treeVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <div aria-label="Open files" className="flex flex-1 min-w-0 overflow-x-auto">
            {tabs.map(([tabKey, item]) => (
              <div
                key={tabKey}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-r border-border text-xs",
                  key === tabKey
                    ? "bg-bg-primary text-text-primary"
                    : "text-text-muted",
                )}
              >
                <button
                  title={item.file}
                  onClick={() => void open(repoPath, item.file)}
                  className="px-2 py-2 max-w-36 md:max-w-56 truncate"
                >
                  {isDirty(item) && <span className="text-accent mr-1">●</span>}
                  {item.file.split("/").pop()}
                </button>
                <button
                  aria-label={"Close " + item.file}
                  disabled={item.saving || item.loading}
                  onClick={() => void closeTab(tabKey)}
                  className="px-1 mr-1 disabled:opacity-30"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 px-1 border-l border-border">
            {doc && <button
              title="Save file (Cmd/Ctrl+S)"
              aria-label="Save"
              onClick={() => void saveCurrent()}
              disabled={!doc.loaded || !isDirty(doc) || doc.saving || doc.loading || doc.external}
              className="editor-save-button flex items-center justify-center gap-1.5 h-8 px-2 rounded text-xs text-accent hover:bg-accent/10 disabled:text-text-muted disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {doc.saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span className="hidden md:inline">Save</span>
            </button>}
            {doc && <button
              aria-label={focused ? "Exit expanded editor" : "Expand editor"}
              title={focused ? "Exit expanded editor (Esc)" : "Expand editor"}
              aria-pressed={focused}
              onClick={() => setFocused((value) => !value)}
              className="editor-icon-button"
            >
              {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>}
            {doc && (!doc.loaded || doc.loading) && <button
              title="Reload from server"
              aria-label="Reload from server"
              disabled={doc.loading || doc.saving}
              onClick={() => void reloadCurrent()}
              className="editor-icon-button disabled:opacity-30"
            ><RefreshCw size={14} /></button>}
            <div ref={setToolbarContainer} />
          </div>
        </div>
        {!doc ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
            <FileText size={36} />
            <p className="text-sm">Select a file to edit</p>
            <p className="text-xs text-center px-4">
              Changes are written to the server only when you save.
            </p>
          </div>
        ) : (
          <>
            {doc.external && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 px-3 py-2 bg-warning/10 text-warning text-xs shrink-0"
              >
                <AlertTriangle size={14} />
                <span className="flex-1">
                  The file changed on the server. Your draft is preserved; copy
                  it before reloading to merge your changes.
                </span>
                <button
                  className="underline flex items-center gap-1"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(doc.content)
                      .then(() => toast("success", "Draft copied"))
                      .catch(() =>
                        toast(
                          "error",
                          "Copy unavailable; select and copy the editor text manually.",
                        ),
                      )
                  }
                >
                  <Copy size={12} />
                  Copy draft
                </button>
                <button
                  className="underline"
                  onClick={() => void reloadCurrent()}
                >
                  Reload
                </button>
              </div>
            )}
            {doc.error && (
              <p
                role="alert"
                className="px-3 py-2 text-xs text-danger border-b border-border shrink-0"
              >
                {doc.error}
              </p>
            )}
            {doc.loading ? (
              <div className="flex-1 grid place-items-center text-text-muted">
                <Loader2 className="animate-spin" size={20} />
              </div>
            ) : doc.loaded ? (
              <Suspense
                fallback={
                  <div className="p-4 text-xs text-text-muted">
                    Loading editor…
                  </div>
                }
              >
                <CodeEditor
                  documentKey={key}
                  doc={doc}
                  onSave={() => void saveCurrent()}
                  toolbarContainer={toolbarContainer}
                  onReload={() => void reloadCurrent()}
                />
              </Suspense>
            ) : (
              <div className="flex-1 grid place-items-center text-xs text-text-muted">
                This file cannot be edited.
              </div>
            )}
            <div className="px-3 py-1 text-[0.65rem] text-text-muted border-t border-border flex justify-between shrink-0">
              <span>
                {doc.loaded
                  ? doc.saving
                    ? "Saving…"
                    : isDirty(doc)
                      ? "Unsaved changes"
                      : "Saved"
                  : "Read unavailable"}
              </span>
              <span>UTF-8 · {doc.lineEnding.toUpperCase()}<span className="hidden md:inline"> · Cmd/Ctrl+S</span></span>
            </div>
          </>
        )}
      </section>}
    </div>
  );
}
