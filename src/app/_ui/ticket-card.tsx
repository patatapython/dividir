import { LIST_ROW } from './show-more';

/** `listRow` marks the card as one row of a list (focus target of "Ver más" and folding). */
export function TicketCard({ className, listRow, children }: { className?: string; listRow?: boolean; children: React.ReactNode }) {
  return (
    <div className="ticket-wrap" {...(listRow ? LIST_ROW : {})}>
      <article className={className ? `ticket ${className}` : 'ticket'}>{children}</article>
    </div>
  );
}
