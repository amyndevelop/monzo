import type { Metadata } from 'next';
import Link from 'next/link';
import { getAuth } from '@/modules/auth/server';
import { isAuthConfigured } from '@/modules/auth/config';
import { headers } from 'next/headers';
import { Logo } from '@/components/brand/logo';
import { AcceptInvitation } from '@/components/platform/accept-invitation';
export const metadata: Metadata = {
  title: 'Invitación de equipo',
  robots: { index: false, follow: false },
};
export default async function Invitation({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = isAuthConfigured()
    ? await getAuth().api.getSession({ headers: await headers() })
    : null;
  return (
    <main id="main" className="invitation-page">
      <Logo />
      <h1>Te espera una nueva conexión.</h1>
      <p>
        Esta invitación se puede aceptar una sola vez y con la cuenta del correo que la recibió.
      </p>
      {session?.user.emailVerified ? (
        <AcceptInvitation token={token} />
      ) : (
        <div className="form-message">
          <p>
            Primero ingresá con una cuenta verificada. Después volvé a abrir el enlace del correo.
          </p>
          <Link href="/ingresar">Ingresar →</Link>
          <br />
          <Link href="/registro">Crear cuenta →</Link>
        </div>
      )}
    </main>
  );
}
