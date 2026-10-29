export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/auth-page';
import { AuthForm } from '@/components/auth/auth-form';
export const metadata: Metadata = {
  title: 'Crear cuenta',
  robots: { index: false, follow: false },
};
export default function Register() {
  return (
    <AuthPage
      title="Tu próximo hola empieza acá."
      description="Creá tu cuenta personal. Verificá tu correo y después prepará el espacio de tu empresa."
    >
      <AuthForm mode="register" />
    </AuthPage>
  );
}
