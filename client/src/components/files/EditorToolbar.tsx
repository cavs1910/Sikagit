import { useRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Ellipsis, Minus, Plus, Search } from "lucide-react";
import { undo, redo } from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { Command } from "@codemirror/view";
import { useUIStore } from "../../store/uiStore";

const itemClass = "flex min-h-9 items-center gap-2 px-3 py-2 text-xs outline-none cursor-pointer data-[highlighted]:bg-bg-tertiary data-[disabled]:opacity-40 data-[disabled]:pointer-events-none rounded";
const menuClass = "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-lg border border-border bg-bg-secondary text-text-primary p-1 shadow-xl";

export function EditorToolbar({ onCommand, onReload, canReload }: {
  onCommand: (command: Command) => void;
  onReload: () => void;
  canReload: boolean;
}) {
  const fontSize = useUIStore((s) => s.editorFontSize);
  const wordWrap = useUIStore((s) => s.editorWordWrap);
  const setFontSize = useUIStore((s) => s.setEditorFontSize);
  const setWordWrap = useUIStore((s) => s.setEditorWordWrap);
  const pendingAction = useRef<(() => void) | null>(null);
  const commandItem = (label: string, command: Command) => (
    <DropdownMenu.Item className={itemClass} onSelect={() => { pendingAction.current = () => onCommand(command); }}>{label}</DropdownMenu.Item>
  );
  return (
    <div role="group" aria-label="Editor controls" className="flex items-center gap-0.5">
      <button aria-label="Find and replace" title="Find and replace (Cmd/Ctrl+F)" onClick={() => onCommand(openSearchPanel)} className="editor-icon-button">
        <Search size={15} />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button aria-label="Editor actions" title="Editor actions" className="editor-icon-button">
            <Ellipsis size={17} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className={`${menuClass} w-64 max-w-[calc(100vw-16px)]`}
            onCloseAutoFocus={(event) => {
              const action = pendingAction.current;
              pendingAction.current = null;
              if (action) {
                event.preventDefault();
                action();
              }
            }}
          >
            <DropdownMenu.Label className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">View</DropdownMenu.Label>
            <div role="group" aria-label="Text size" className="flex items-center gap-1 px-3 py-1 text-xs">
              <span className="mr-auto">Text size</span>
              <DropdownMenu.Item asChild disabled={fontSize <= 10} onSelect={(event) => { event.preventDefault(); setFontSize(fontSize - 1); }}>
                <button aria-label="Decrease text size" className="editor-icon-button data-[disabled]:opacity-30"><Minus size={13} /></button>
              </DropdownMenu.Item>
              <span role="status" aria-label="Editor text size" className="w-10 shrink-0 whitespace-nowrap text-center tabular-nums text-text-secondary">{fontSize} px</span>
              <DropdownMenu.Item asChild disabled={fontSize >= 24} onSelect={(event) => { event.preventDefault(); setFontSize(fontSize + 1); }}>
                <button aria-label="Increase text size" className="editor-icon-button data-[disabled]:opacity-30"><Plus size={13} /></button>
              </DropdownMenu.Item>
            </div>
            <DropdownMenu.CheckboxItem checked={wordWrap} onCheckedChange={(value) => setWordWrap(value === true)} className={itemClass}>
              Word wrap <span className="ml-auto w-3"><DropdownMenu.ItemIndicator><Check size={12} /></DropdownMenu.ItemIndicator></span>
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Separator className="h-px my-1 bg-border" />
            <DropdownMenu.Label className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Edit</DropdownMenu.Label>
            {commandItem("Find / replace…", openSearchPanel)}
            {commandItem("Go to line…", gotoLine)}
            {commandItem("Undo", undo)}
            {commandItem("Redo", redo)}
            <DropdownMenu.Separator className="h-px my-1 bg-border" />
            {commandItem("Fold all", foldAll)}
            {commandItem("Unfold all", unfoldAll)}
            <DropdownMenu.Separator className="h-px my-1 bg-border" />
            <DropdownMenu.Item disabled={!canReload} className={itemClass} onSelect={() => { pendingAction.current = onReload; }}>Reload from server…</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
