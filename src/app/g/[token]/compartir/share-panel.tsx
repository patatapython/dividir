'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/app/_ui/button';
import { SectionLabel } from '@/app/_ui/section-label';
import { qrCode } from '@/app/_ui/qr';

// Read once the page is in the browser: the server cannot know the address the group is
// reached at, and the share sheet only exists on some devices (most phones).
const noSubscription = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => null);
const useCanShare = () => useSyncExternalStore(noSubscription, () => typeof navigator.share === 'function', () => false);

type Notice = 'copied' | 'copy-failed' | 'share-failed' | null;

const NOTICES: Record<Exclude<Notice, null>, string> = {
  copied: 'Enlace copiado.',
  'copy-failed': 'No se ha podido copiar. El enlace está seleccionado: cópialo desde el menú del navegador.',
  'share-failed': 'No se ha podido abrir el menú de compartir. Copia el enlace.',
};

/**
 * The group link three ways: the device's share sheet where there is one, a copy that
 * falls back to a selected link, and a QR code to scan from another phone. Whoever has
 * the link can see and add expenses, so the page says so.
 */
export function SharePanel({ token, groupName }: { token: string; groupName: string }) {
  const origin = useOrigin();
  const canShare = useCanShare();
  const url = origin ? `${origin}/g/${token}` : null;
  const qr = useMemo(() => (url ? qrCode(url) : null), [url]);
  const linkInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function share() {
    if (!url) return;
    setNotice(null);
    try {
      await navigator.share({ title: groupName, text: `Apunta los gastos de «${groupName}» en dividir`, url });
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('share-failed');
    }
  }

  async function copy() {
    if (!url) return;
    setNotice(null);
    try {
      // Missing outside a secure context (plain http), and it can be refused.
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      setNotice('copied');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setNotice('copy-failed');
    }
  }

  return (
    <section className="panel share-panel">
      <SectionLabel level={2}>Comparte el grupo</SectionLabel>
      <p className="muted">
        Quien tenga el enlace puede ver y apuntar gastos: compártelo solo con el grupo. Nadie necesita registrarse.
      </p>
      <input
        ref={linkInput}
        className="mono share-url"
        readOnly
        value={url ?? ''}
        aria-label="Enlace del grupo"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="share-actions">
        {canShare && (
          <Button type="button" disabled={!url} onClick={share}>
            Compartir enlace
          </Button>
        )}
        <Button type="button" variant={canShare ? 'ghost' : 'primary'} disabled={!url} onClick={copy}>
          Copiar enlace
        </Button>
      </div>
      <p className="share-notice" role="status">
        {notice && NOTICES[notice]}
      </p>
      <figure className="share-qr">
        {qr ? (
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="Código QR con el enlace del grupo" shapeRendering="crispEdges">
            <rect className="share-qr-light" width={qr.size} height={qr.size} />
            <path className="share-qr-dark" d={qr.path} />
          </svg>
        ) : (
          <div className="share-qr-placeholder" />
        )}
        <figcaption className="muted">Para quien está a tu lado: que lo escanee con la cámara del móvil.</figcaption>
      </figure>
      <Link className="btn btn--ghost" href={`/g/${token}`}>
        Ir al grupo
      </Link>
    </section>
  );
}
