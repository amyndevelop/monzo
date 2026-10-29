import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'MONZO — Tus conversaciones trabajan por vos', template: '%s | MONZO' },
  description:
    'Conocé MONZO: la plataforma en desarrollo para centralizar tu atención y automatizar conversaciones con inteligencia artificial.',
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>
        <a className="skip-link" href="#main">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
