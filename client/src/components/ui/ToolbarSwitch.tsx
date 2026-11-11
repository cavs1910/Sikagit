import { cn } from '../../lib/utils';

export function ToolbarSwitch({ label, shortLabel, title, checked, onChange }: {
  label: string; shortLabel?: string; title: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} title={title}
    className="flex shrink-0 items-center gap-2 rounded py-1 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent">
    {shortLabel ? <><span className="hidden md:inline">{label}</span><span className="md:hidden">{shortLabel}</span></> : label}
    <span aria-hidden="true" className={cn('inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border p-[2px] transition-colors', checked ? 'bg-accent border-accent' : 'bg-bg-tertiary border-border')}>
      <span className={cn('block h-[12px] w-[12px] shrink-0 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[14px]' : 'translate-x-0')} />
    </span>
  </button>;
}
