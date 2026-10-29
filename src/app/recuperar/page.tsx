export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/auth-page';
import { AuthForm } from '@/components/auth/auth-form';
export const metadata: Metadata = {
  title: 'Recuperar acceso',
  robots: { index: false, follow: false },
};
export default function Forgot() {
  return (
    <AuthPage
      title="Recuperemos tu acceso."
      description="Te enviaremos un enlace si existe una cuenta con ese correo."
    >
      <AuthForm mode="forgot" />
    </AuthPage>
  );
}
