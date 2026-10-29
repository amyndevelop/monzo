import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Mascot } from '@/components/brand/mascot';
import { isAuthConfigured } from '@/modules/auth/config';
export function AuthPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="auth-page">
      <div className="auth-top">
        <Logo />
        <Link href="/">Volver al sitio</Link>
      </div>
      <div className="auth-grid">
        <section className="auth-story">
          <p className="eyebrow">TU ESPACIO, TUS CONEXIONES</p>
          <h1>
            Tu negocio merece
            <br />
            un espacio propio.
          </h1>
          <p>
            Personas conectadas.
            <br />
            Información de cada empresa en su lugar.
          </p>
          <Mascot reaction="welcome" size={290} priority />
          <span>
            <ShieldCheck size={17} /> Acceso personal. Espacios independientes.
          </span>
        </section>
        <section className="auth-card">
          <p className="eyebrow">BIENVENIDO A MONZO</p>
          <h2>{title}</h2>
          <p className="auth-description">{description}</p>
          {isAuthConfigured() ? (
            children
          ) : (
            <div className="form-message">
              <p>
                Estamos preparando el acceso seguro. La configuración de cuentas todavía no está
                habilitada en esta instancia.
              </p>
              <Link href="/demo">Mientras tanto, explorá la demo pública →</Link>
            </div>
          )}
        </section>
      </div>
      <p className="auth-footer">MONZO · Conversaciones que conectan.</p>
    </main>
  );
}
