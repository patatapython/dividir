import { GroupNotFoundCard } from './group-not-found-card';

// A page under the group calls notFound() for a sub-entity (expense, charge)
// the group no longer holds. The layout already resolved the group, so this is
// never "group not found": an unknown token 404s in the layout and bubbles
// past this boundary to app/g/not-found.tsx.
export default function GroupItemNotFound() {
  return (
    <GroupNotFoundCard title="Esto ya no existe">
      Puede que se haya borrado desde otro dispositivo. El grupo sigue aquí.
    </GroupNotFoundCard>
  );
}
