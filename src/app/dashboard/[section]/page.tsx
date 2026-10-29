import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireDashboardContext } from '@/modules/access/policy';
import { getWorkspace, listMembers } from '@/modules/tenants/service';
import { SettingsForm } from '@/components/platform/settings-form';
import { TeamManager } from '@/components/platform/team-manager';
import { getSection } from '@/modules/platform/navigation';
import { Mascot } from '@/components/brand/mascot';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  return { title: getSection((await params).section)?.label ?? 'Página no encontrada' };
}
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const context = await requireDashboardContext();
  const { section } = await params;
  const item = getSection(section);
  if (!item) notFound();
  return (
    <>
      <div className="dashboard-page-title">
        <div>
          <p className="eyebrow">{context.tenant.name}</p>
          <h1>
            {item.label}
            <span className="turquoise">.</span>
          </h1>
          <p>{item.description}</p>
        </div>
      </div>
      {section === 'equipo' ? (
        <TeamManager
          tenantId={context.tenant.id}
          members={await listMembers(context.tenant.id)}
          owner={context.membership.role === 'OWNER'}
        />
      ) : section === 'configuracion' ? (
        <SettingsPanel tenantId={context.tenant.id} />
      ) : (
        <section className="coming-soon">
          <Mascot reaction="working" size={230} />
          <span className="availability">Próximamente</span>
          <h2>
            Lo próximo se construye
            <br />
            sobre buenas conexiones.
          </h2>
          <p>
            Tu espacio y acceso ya están preparados. Esta función todavía no está disponible y no
            procesa datos operativos.
          </p>
        </section>
      )}
    </>
  );
}
async function SettingsPanel({ tenantId }: { tenantId: string }) {
  const { tenant, role, settings } = await getWorkspace(tenantId);
  return (
    <SettingsForm
      tenantId={tenantId}
      name={tenant.name}
      timezone={settings?.timezone ?? 'America/Argentina/Buenos_Aires'}
      locale={settings?.locale ?? 'es-AR'}
      canEdit={role !== 'MEMBER'}
    />
  );
}
