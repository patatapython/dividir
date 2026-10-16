import { LIST_ROW } from './show-more';

/** A label ···· value row. Optional `actions` (row buttons) sit beside the value
 * on a wide list and on their own line below it, right-aligned, on a narrow one:
 * the width of the list decides, never the length of the label, so every row of a
 * list has the same shape. `listRow` marks it as one row of a list (focus target
 * of folding). */
export function DotLeaderRow({ label, end, actions, listRow }: { label: React.ReactNode; end: React.ReactNode; actions?: React.ReactNode; listRow?: boolean }) {
  return (
    <div className={actions ? 'leader-row leader-row--actions' : 'leader-row'} {...(listRow ? LIST_ROW : {})}>
      <span className="leader-label">{label}</span>
      <span className="leader" aria-hidden="true" />
      {end}
      {actions && <span className="leader-actions">{actions}</span>}
    </div>
  );
}
