import { notFound } from 'next/navigation';

// Any path under a group that matches no page. It renders inside the group layout,
// which has already checked the token, so the answer is "no such page", not
// "no such group" (that one is app/g/not-found.tsx).
export default function MissingGroupPage(): never {
  notFound();
}
