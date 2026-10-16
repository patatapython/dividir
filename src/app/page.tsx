import { CreateGroupForm } from './create-group-form';
import { RecentGroups } from './_ui/recent-groups-store';
import { SectionLabel } from './_ui/section-label';
import { Stamp } from './_ui/stamp';
import { TicketCard } from './_ui/ticket-card';
import { DotLeaderRow } from './_ui/dot-leader-row';
import { MoneyAmount } from './_ui/money-amount';
import { asCents } from '@/domain/money';
import { PixelArt } from './_ui/pixel-art';

/** The headline's three verbs, spelled out: what a newcomer needs before creating a group. */
const STEPS = [
  {
    title: 'Apunta',
    text: 'Cada gasto, quién lo pagó y entre quiénes se reparte. Nadie se registra: todo el grupo usa el mismo enlace.',
  },
  {
    title: 'Divide',
    text: 'dividir lo reparte al céntimo: a partes iguales, por partes, por porcentaje o con importes exactos.',
  },
  {
    title: 'Salda',
    text: 'Quién debe a quién, y cómo quedar en paz con el mínimo de pagos.',
  },
];

/*
 * No calls to action pointing further down the same page: the form is the
 * action, and how it works is shown, not linked. One column at every width
 * (D-06): returning people find their groups first, the sample comes last.
 */
export default function LandingPage() {
  return (
    <main className="container landing">
      <div className="landing-copy">
        <span className="badge">Sin cuentas</span>
        <p className="section-label">DIVIDIR</p>
        <PixelArt name="pilgrim" className="landing-art" />
        <h1>Apunta, divide, salda.</h1>
        <p className="landing-sub">
          Cuentas de grupo sin registrarse: crea un grupo, comparte el enlace y listo. El enlace es la llave.
        </p>
      </div>

      <RecentGroups />

      <section className="landing-how" aria-labelledby="como-funciona">
        <h2 id="como-funciona">Cómo funciona</h2>
        <ol className="how-steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="how-step">
              <span className="how-number" aria-hidden="true">{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel landing-form" aria-labelledby="crear-grupo">
        <h2 id="crear-grupo">Crear un grupo</h2>
        <CreateGroupForm />
        <p className="muted">
          El enlace del grupo es la llave: cualquiera que lo tenga puede ver y anotar gastos. Compártelo solo con tu grupo.
        </p>
      </section>

      <TicketCard className="ticket--featured">
        <div className="card-head">
          <SectionLabel level={2}>Cena de equipo</SectionLabel>
          <Stamp>Ejemplo</Stamp>
        </div>
        <DotLeaderRow label="Cena en El Faro" end={<MoneyAmount cents={asCents(8460)} />} />
        <DotLeaderRow label="Ronda de cañas" end={<MoneyAmount cents={asCents(1440)} />} />
        <DotLeaderRow label="Gasolina" end={<MoneyAmount cents={asCents(5200)} />} />
        <div className="landing-total">
          <DotLeaderRow label={<strong>CADA UNO</strong>} end={<strong><MoneyAmount cents={asCents(3775)} /></strong>} />
        </div>
      </TicketCard>
    </main>
  );
}
