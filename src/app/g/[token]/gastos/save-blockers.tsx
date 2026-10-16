import { describeProblem, type FormProblem } from './ticket-model';

/**
 * Why "Guardar" is disabled, beside it. The list is the very one that disables the button, so the two can
 * never disagree; the button points here through `aria-describedby={id}`, and the list sits right above
 * it in reading order. It changes with every keystroke, so it is deliberately NOT a live region (it would
 * announce each one); it describes what is missing rather than accusing a value. Inline errors stay terse
 * ("Los pagos no cuadran con el total."); the figures live here.
 */
export function SaveBlockers({ id, problems, nameOf }: {
  id: string;
  problems: FormProblem[];
  nameOf: (id: string) => string;
}) {
  if (problems.length === 0) return null;
  return (
    <div id={id} className="save-blockers">
      <p>Para poder guardar:</p>
      <ul>
        {problems.map((p, i) => (
          <li key={i}>{describeProblem(p, nameOf)}</li>
        ))}
      </ul>
    </div>
  );
}
