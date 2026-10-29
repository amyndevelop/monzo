'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, PanelLeftClose, House, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { SignOut } from '@/components/auth/sign-out';
import { WorkspaceSwitcher, type WorkspaceOption } from './workspace-picker';
import { platformSections } from '@/modules/platform/navigation';
export function PrivateShell({
  children,
  user,
  memberships,
  tenantId,
  role,
}: {
  children: React.ReactNode;
  user: { name: string };
  memberships: WorkspaceOption[];
  tenantId: string;
  role: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="dashboard-layout">
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`dashboard-sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Logo />
          <Button
            className="sidebar-close"
            variant="ghost"
            size="icon"
            aria-label="Cerrar navegación"
            onClick={() => setOpen(false)}
          >
            <PanelLeftClose />
          </Button>
        </div>
        <div className="workspace-area">
          <WorkspaceSwitcher memberships={memberships} activeId={tenantId} />
        </div>
        <p className="nav-label">TU ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación privada">
          <Link
            className={`dashboard-nav-item ${path === '/dashboard' ? 'active' : ''}`}
            href="/dashboard"
            onClick={() => setOpen(false)}
          >
            <House size={17} />
            Inicio
          </Link>
          {platformSections.map((section) => (
            <Link
              key={section.slug}
              href={`/dashboard/${section.slug}`}
              onClick={() => setOpen(false)}
              className={`dashboard-nav-item ${path === `/dashboard/${section.slug}` ? 'active' : ''}`}
              aria-current={path === `/dashboard/${section.slug}` ? 'page' : undefined}
            >
              {section.label}
              {!['equipo', 'configuracion', 'canales', 'contactos', 'conversaciones'].includes(
                section.slug,
              ) && <span className="nav-soon" aria-label="Próximamente" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="build-note">
            <ShieldCheck size={22} />
            <strong>
              {role === 'OWNER' ? 'Propietario' : role === 'ADMIN' ? 'Administrador' : 'Miembro'}
            </strong>
            <p>El acceso se verifica en cada operación.</p>
          </div>
          <Link href="/empresas" className="back-to-site">
            Mis empresas <ArrowUpRight size={15} />
          </Link>
          <Link href="/" className="back-to-site">
            Volver al sitio <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="dashboard-heading">
            <Button
              className="sidebar-toggle"
              variant="ghost"
              size="icon"
              aria-label="Abrir navegación"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </Button>
            <strong>{user.name}</strong>
            <span className="session-indicator">
              <ShieldCheck size={14} /> Sesión verificada
            </span>
          </div>
          <SignOut />
        </header>
        <main id="main" className="dashboard-content">
          {children}
        </main>
        <footer className="dashboard-footer">
          MONZO Cloud<span>Tu empresa, tu espacio</span>
        </footer>
      </div>
    </div>
  );
}
