import { getLedgerExport } from '@/server/queries';
import { todayKey } from '@/app/_ui/dates';
import { ledgerCsv, ledgerFilename } from './ledger-csv';

/**
 * GET /g/<token>/exportar — the reparto ledger as a CSV download (T-53). The
 * token is the credential (§2.1): an unknown one gets a bare 404 and is never
 * echoed; the file is never stored by caches, since the URL alone grants it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ledger = await getLedgerExport(token);
  if (!ledger) return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(ledgerCsv(ledger), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ledgerFilename(ledger.groupName, todayKey())}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
