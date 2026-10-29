import type { Metadata } from 'next';
import { PrivateShell } from '@/components/platform/private-shell';
import { requireDashboardContext } from '@/modules/access/policy';
import { listWorkspaces } from '@/modules/tenants/service';
export const metadata: Metadata = { title: 'Mi empresa', robots: { index: false, follow: false } };
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await requireDashboardContext();
  const { memberships } = await listWorkspaces();
  return (
    <PrivateShell
      user={context.user}
      memberships={memberships}
      tenantId={context.tenant.id}
      role={context.membership.role}
    >
      {children}
    </PrivateShell>
  );
}
