/**
 * A section's heading, set as a micro-label (T-29). The level is the caller's
 * to state: it depends on what sits above (the group name is the h1; a form's
 * title is an h2, so its sections are h3), and a silent default would skip.
 */
export function SectionLabel({ level, children }: { level: 2 | 3; children: React.ReactNode }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return <Heading className="section-label">{children}</Heading>;
}
