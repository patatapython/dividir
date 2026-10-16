/**
 * A labelled control. The error lives OUTSIDE the <label>: inside it, the error text would become part of
 * the control's accessible name ("Importe ✗ Importe no válido"). The control points at it instead through
 * `aria-describedby={errorId}`, which the caller sets on its input.
 */
export function Field({ label, error, errorId, className, children }: {
  label: React.ReactNode; error?: string | null; errorId?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label>
        <span>{label}</span>
        {children}
      </label>
      {error ? <p id={errorId} className="error" role="alert">{error}</p> : null}
    </div>
  );
}
