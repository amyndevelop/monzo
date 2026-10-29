import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/auth-page';
import { AuthForm } from '@/components/auth/auth-form';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Verificar correo',
  robots: { index: false, follow: false },
};
export default function Verify() {
  return (
    <AuthPage
      title="Confirmemos tu correo."
      description="Si tu cuenta necesita verificación, te enviaremos un nuevo enlace."
    >
      <AuthForm mode="verify" />
    </AuthPage>
  );
}
