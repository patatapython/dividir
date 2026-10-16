import type { Metadata } from 'next';
import { grotesk, mono } from './fonts';
import './globals.css';
import { FocusKeeper } from './_ui/focus-keeper';

export const metadata: Metadata = {
  title: 'dividir',
  description: 'Divide gastos con tu grupo y salda cuentas con los mínimos pagos',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${grotesk.variable} ${mono.variable}`}>
        <FocusKeeper />
        {children}
      </body>
    </html>
  );
}
