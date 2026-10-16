'use client';
export function Chip({ on = false, variant = 'person', onToggle, className, children }: {
  on?: boolean; variant?: 'person' | 'add'; onToggle?: () => void;
  className?: string; children: React.ReactNode;
}) {
  const cls = [
    'chip',
    variant === 'add' ? 'chip--add' : !on ? 'chip--off' : '',
    on ? className : undefined,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-pressed={variant === 'add' ? undefined : on} onClick={onToggle}>
      {children}
    </button>
  );
}

/**
 * A chip that is one choice among several (a native radio, so the arrow keys move
 * between the options). Same look as a Chip: filled when chosen.
 */
export function ChipRadio({ name, checked, onChange, className, children }: {
  name: string; checked: boolean; onChange: () => void;
  className?: string; children: React.ReactNode;
}) {
  const cls = ['chip', 'chip--radio', checked ? className : 'chip--off'].filter(Boolean).join(' ');
  return (
    <label className={cls}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}
