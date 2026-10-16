'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TicketCard } from '@/app/_ui/ticket-card';
import { PixelArt } from '@/app/_ui/pixel-art';

/** A not-found page inside a group: the group exists, so the way back is to it. */
export function GroupNotFoundCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { token } = useParams<{ token: string }>();
  return (
    <div style={{ paddingTop: 16 }}>
      <TicketCard className="lost-card">
        <PixelArt name="rooster" className="lost-art" />
        <h2 className="screen-title">{title}</h2>
        <p className="muted">{children}</p>
        <div style={{ marginTop: 12 }}>
          <Link className="btn btn--dark" href={`/g/${token}`}>
            Volver al grupo
          </Link>
        </div>
      </TicketCard>
    </div>
  );
}
