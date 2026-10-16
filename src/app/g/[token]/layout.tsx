import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireGroup } from '@/server/group-scope';
import { IdentityButton, IdentityDialog, IdentityProvider } from './identity';
import { identityOptions } from './identity-options';
import { HeaderLinks, ModeFrame, ModeSwitch } from './group-nav';
import { SHARE_HREF } from './group-navigation';
import { RememberGroup } from '@/app/_ui/recent-groups-store';

export const metadata = { robots: { index: false, follow: false } };

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const group = await requireGroup(token);
  const cookieStore = await cookies();
  const claimedId = cookieStore.get(`participant_${group.id}`)?.value;
  const options = identityOptions(group.participants, claimedId);

  const base = `/g/${token}`;

  return (
    <IdentityProvider token={token} options={options}>
      <RememberGroup token={token} name={group.name} />
      <header className="appbar on-dark">
        <div className="appbar-inner">
          <div className="appbar-top">
            <Link className="tab" href="/">
              <span aria-hidden="true">←&nbsp;</span>Tus grupos
            </Link>
            <HeaderLinks base={base} />
          </div>
          <div className="appbar-title">
            <h1>
              <Link href={base} style={{ textDecoration: 'none', color: 'inherit' }}>
                {group.name}
              </Link>
            </h1>
            <div className="appbar-actions">
              <IdentityButton />
              <Link className="btn btn--ghost btn--sm" href={`${base}${SHARE_HREF}`}>
                Compartir
              </Link>
            </div>
          </div>
          <ModeSwitch base={base} />
        </div>
      </header>
      <ModeFrame base={base}>
        <IdentityDialog />
        {children}
      </ModeFrame>
    </IdentityProvider>
  );
}
