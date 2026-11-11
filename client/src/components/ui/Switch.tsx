import { useId } from 'react';
import { cn } from '../../lib/utils';

interface SwitchProps {
  label: string;
  shortLabel?: string;
  description?: string;
  title?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/** Shared boolean option control for toolbars, settings and dialogs. */
export function Switch({ label, shortLabel, description, title, checked, disabled, onChange, className }: SwitchProps) {
  const descriptionId = useId();
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled} onClick={() => onChange(!checked)} title={title}
      className={cn('flex min-w-0 items-center gap-3 rounded py-1 text-left text-xs text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed', className)}>
      <span className="min-w-0 flex-1">
        {shortLabel ? <><span className="hidden md:inline">{label}</span><span className="md:hidden">{shortLabel}</span></> : label}
        {description && <span id={descriptionId} className="block mt-1 text-[0.65rem] font-normal text-text-muted leading-relaxed">{description}</span>}
      </span>
      <span aria-hidden="true" className={cn('inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border p-[2px] transition-colors', checked ? 'bg-accent border-accent' : 'bg-bg-tertiary border-border')}>
        <span className={cn('block h-[12px] w-[12px] shrink-0 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[14px]' : 'translate-x-0')} />
      </span>
    </button>
  );
}
