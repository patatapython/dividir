import Link from 'next/link';
import { TicketCard } from '@/app/_ui/ticket-card';
import { PixelArt } from '@/app/_ui/pixel-art';
import { ForgetMissingGroup } from '@/app/_ui/recent-groups-store';

// The group layout found no group for the token: whichever page of it was asked
// for, the link leads nowhere, so this device forgets it.
export default function GroupNotFound() {
  return (
    <main className="container" style={{ paddingTop: 32 }}>
      <ForgetMissingGroup />
      <TicketCard className="lost-card">
        <PixelArt name="rooster" className="lost-art" />
        <h1>Grupo no encontrado</h1>
        <p className="muted">El enlace no corresponde a ningún grupo. Revisa que esté completo.</p>
        <Link className="btn btn--dark" href="/">
          Crear un grupo
        </Link>
      </TicketCard>
    </main>
  );
}
