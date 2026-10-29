export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/auth-page';
import { AuthForm } from '@/components/auth/auth-form';
export const metadata: Metadata = { title: 'Ingresar', robots: { index: false, follow: false } };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ verificado?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthPage
      title="Qué bueno verte de nuevo."
      description="Ingresá con tu cuenta para acceder a tus empresas."
    >
      {params.error && (
        <p className="form-error" role="alert">
          El enlace no es válido o venció. Ingresá a tu cuenta para solicitar uno nuevo.
        </p>
      )}
      <AuthForm mode="login" verified={params.verificado === '1'} />
    </AuthPage>
  );
}
