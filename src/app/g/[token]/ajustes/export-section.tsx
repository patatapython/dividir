import { SectionLabel } from '@/app/_ui/section-label';

/** Where the reparto ledger is downloaded (T-53). A plain link: the route answers with a file, not a page. */
export function ExportSection({ token }: { token: string }) {
  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <SectionLabel level={2}>Exportar</SectionLabel>
      <p className="muted">
        Los gastos, pagos y reembolsos del reparto en una hoja de cálculo, con lo que cada movimiento suma o resta a cada
        persona y el saldo final. Los gastos sin pagar van aparte; el bote no se incluye.
      </p>
      <a className="btn btn--ghost btn--sm" href={`/g/${token}/exportar`} download>
        Descargar CSV
      </a>
    </section>
  );
}
