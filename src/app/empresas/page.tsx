import type { Metadata } from 'next';
import { Logo } from '@/components/brand/logo';
import { SignOut } from '@/components/auth/sign-out';
import { WorkspacePicker } from '@/components/platform/workspace-picker';
import { requirePageUser } from '@/modules/access/policy';
import { listWorkspaces } from '@/modules/tenants/service';
export const metadata: Metadata = {
  title: 'Mis empresas',
  robots: { index: false, follow: false },
};
export default async function Workspaces({
  searchParams,
}: {
  searchParams: Promise<{ acceso?: string }>;
}) {
  const user = await requirePageUser();
  const { memberships } = await listWorkspaces();
  const params = await searchParams;
  return (
    <main id="main" className="workspaces-page container">
      <header>
        <Logo />
        <SignOut />
      </header>
      <div className="workspaces-title">
        <p className="eyebrow">UN ESPACIO PARA CADA NEGOCIO</p>
        <h1>¿Dónde seguimos, {user.name.split(' ')[0]}?</h1>
        <p>Elegí una de tus empresas o creá una nueva.</p>
      </div>
      {params.acceso === 'denegado' && (
        <p role="alert" className="form-error">
          Tu acceso a ese espacio no está disponible. Elegí una empresa autorizada.
        </p>
      )}
      <WorkspacePicker memberships={memberships} />
    </main>
  );
}
