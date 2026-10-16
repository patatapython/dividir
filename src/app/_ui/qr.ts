import { encode } from 'uqr';

/** Light modules scanners need around a QR symbol (ISO/IEC 18004). */
export const QR_QUIET_ZONE = 4;

/**
 * The group link as a QR code: one SVG path, one unit square per dark module, in a
 * `size × size` viewBox that already includes the quiet zone. It is computed on the
 * device, never by a QR service: the link is the group's credential (spec §2.1).
 * Level M survives a smudged or partly covered screen.
 */
export function qrCode(text: string): { size: number; path: string } {
  const { size, data } = encode(text, { ecc: 'M', border: QR_QUIET_ZONE });
  const path = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join('');
  return { size, path };
}
