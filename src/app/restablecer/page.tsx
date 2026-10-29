export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/auth-page';
import { AuthForm } from '@/components/auth/auth-form';
export const metadata: Metadata = {
  title: 'Nueva contraseña',
  robots: { index: false, follow: false },
};
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthPage
      title="Un nuevo comienzo."
      description="Elegí una contraseña larga y única para tu cuenta."
    >
      <AuthForm mode="reset" token={token} />
    </AuthPage>
  );
}
