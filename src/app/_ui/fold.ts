/**
 * Folding of long read lists (D-09): a list longer than FOLD_LIMIT shows its first
 * rows and a toggle that expands it and folds it again, so a big group's screen is
 * not an endless strip. Form lists never fold — a hidden input would still count.
 */
export const FOLD_LIMIT = 5;

export type FoldState =
  | { foldable: false; visible: number }
  | { foldable: true; visible: number; toggle: string; status: string };

/** `rows` are the rows loaded; `total` is the whole list, larger when the list is
 * paged and more remain to load ("Ver más") — then the toggle never says "todos". */
export function foldState(rows: number, expanded: boolean, total = rows): FoldState {
  if (rows <= FOLD_LIMIT) return { foldable: false, visible: rows };
  const visible = expanded ? rows : FOLD_LIMIT;
  return {
    foldable: true,
    visible,
    toggle: expanded ? 'Plegar' : total > rows ? `Ver ${rows} de ${total}` : `Ver todos (${rows})`,
    status: `Mostrando ${visible} de ${total}`,
  };
}
