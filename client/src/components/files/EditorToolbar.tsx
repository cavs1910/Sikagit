import { useRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Search, WrapText } from "lucide-react";
import { undo, redo } from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { Command } from "@codemirror/view";
import { useUIStore } from "../../store/uiStore";
import { cn } from "../../lib/utils";

export function EditorToolbar({ onCommand }: { onCommand: (command: Command) => void }) {
  const fontSize = useUIStore((s) => s.editorFontSize);
  const wordWrap = useUIStore((s) => s.editorWordWrap);
  const setFontSize = useUIStore((s) => s.setEditorFontSize);
  const setWordWrap = useUIStore((s) => s.setEditorWordWrap);
  const pendingCommand = useRef<Command | null>(null);
  const itemClass = "px-3 py-2 text-xs outline-none cursor-pointer data-[highlighted]:bg-bg-tertiary rounded";
  return (
    <div role="group" aria-label="Editor controls" className="flex items-center gap-2 px-3 py-1 border-b border-border text-xs shrink-0">
      <label className="flex items-center gap-1 text-text-muted">
        <span>Text size</span>
        <select
          aria-label="Editor text size"
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="bg-bg-secondary text-text-primary border border-border rounded px-1 py-1"
        >
          {Array.from({ length: 15 }, (_, i) => i + 10).map((size) => (
            <option key={size} value={size}>{size} px</option>
          ))}
        </select>
      </label>
      <button
        aria-label="Word wrap"
        aria-pressed={wordWrap}
        title="Wrap long lines to fit the editor"
        onClick={() => setWordWrap(!wordWrap)}
        className={cn("flex items-center gap-1 rounded px-2 py-1.5 hover:bg-bg-tertiary", wordWrap ? "text-accent bg-accent/10" : "text-text-muted")}
      >
        <WrapText size={14} /> Wrap
      </button>
      <div className="flex-1" />
      <button aria-label="Find and replace" title="Find and replace (Cmd/Ctrl+F)" onClick={() => onCommand(openSearchPanel)} className="p-2 rounded text-text-muted hover:bg-bg-tertiary hover:text-text-primary">
        <Search size={14} />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button aria-label="Editor actions" title="Editor actions" className="p-2 rounded text-text-muted hover:bg-bg-tertiary hover:text-text-primary">
            <Ellipsis size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 w-52 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded border border-border bg-bg-secondary text-text-primary p-1 shadow-xl"
            onCloseAutoFocus={(event) => {
              const command = pendingCommand.current;
              pendingCommand.current = null;
              if (command) {
                event.preventDefault();
                onCommand(command);
              }
            }}
          >
            <DropdownMenu.Item className={itemClass} onSelect={() => { pendingCommand.current = openSearchPanel; }}>Find / replace…</DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => { pendingCommand.current = gotoLine; }}>Go to line…</DropdownMenu.Item>
            <DropdownMenu.Separator className="h-px my-1 bg-border" />
            <DropdownMenu.Item className={itemClass} onSelect={() => { pendingCommand.current = undo; }}>Undo</DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => { pendingCommand.current = redo; }}>Redo</DropdownMenu.Item>
            <DropdownMenu.Separator className="h-px my-1 bg-border" />
            <DropdownMenu.Item className={itemClass} onSelect={() => { pendingCommand.current = foldAll; }}>Fold all</DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => { pendingCommand.current = unfoldAll; }}>Unfold all</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
