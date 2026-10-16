import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { QR_QUIET_ZONE, qrCode } from '@/app/_ui/qr';

const URL = 'https://dividir.example/g/aaaaaaaaaaaaaaaaaaaaaaaa';

describe('qrCode — the group link as one SVG path, drawn on this device', () => {
  const qr = qrCode(URL);
  const reference = encode(URL, { ecc: 'M', border: QR_QUIET_ZONE });

  it('keeps the four-module quiet zone scanners need around the symbol', () => {
    expect(QR_QUIET_ZONE).toBe(4);
    expect(qr.size).toBe(reference.size);
    expect(reference.data[QR_QUIET_ZONE - 1][QR_QUIET_ZONE - 1]).toBe(false);
  });

  it('draws exactly one unit square per dark module, where the module is', () => {
    const squares = qr.path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    const dark = reference.data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : [])));
    expect(squares).toEqual(dark);
    expect(qr.path).toBe(dark.join(''));
  });
});
