import Link from 'next/link';
import { TicketCard } from '@/app/_ui/ticket-card';
import { PixelArt } from '@/app/_ui/pixel-art';

// A URL that matches no route at all. An unknown group link has its own page
// (app/g/not-found.tsx), and so does an unknown page inside a group.
export default function NotFound() {
  return (
    <main className="container" style={{ paddingTop: 32 }}>
      <TicketCard className="lost-card">
        <PixelArt name="rooster" className="lost-art" />
        <h1>Esta página no existe</h1>
        <p className="muted">Revisa que la dirección esté completa.</p>
        <Link className="btn btn--dark" href="/">
          Ir al inicio
        </Link>
      </TicketCard>
    </main>
  );
}
